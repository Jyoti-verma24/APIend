import { supabase, money, nextStage, tailorIsAllowed } from '../lib/tailortrack.js';

/**
 * /api/orders
 *
 * GET  - list every order for the tailor's dashboard.
 * POST - take in a new garment: save the customer, create the order, record
 *        an advance payment if one was taken, and note the delivery reminder.
 */
export default async function handler(request, response) {
  try {
    if (!tailorIsAllowed(request)) {
      return response.status(401).json({ error: 'Wrong passcode' });
    }

    if (request.method === 'GET') return await listOrders(response);
    if (request.method === 'POST') return await createOrder(request, response);

    return response.status(405).json({ error: 'Use GET or POST' });
  } catch (error) {
    console.error('[/api/orders] failed:', error);
    return response.status(500).json({ error: 'Something went wrong on the server' });
  }
}

/** Every order, newest first, with the customer's name and what is still owed. */
async function listOrders(response) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, garment_type, status, total_amount, delivery_date, public_token, customers(name, phone), payments(amount)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const orders = data.map((order) => {
    const paid = order.payments.reduce((sum, payment) => sum + money(payment.amount), 0);
    return {
      id: order.id,
      garmentType: order.garment_type,
      customerName: order.customers?.name ?? 'Unknown',
      customerPhone: order.customers?.phone ?? '',
      status: order.status,
      nextStatus: nextStage(order.status),
      totalAmount: money(order.total_amount),
      balanceDue: money(money(order.total_amount) - paid),
      deliveryDate: order.delivery_date,
      publicToken: order.public_token,
    };
  });

  return response.status(200).json({ success: true, orders });
}

/** Creates one order, plus its customer, advance payment and reminder. */
async function createOrder(request, response) {
  const body = request.body ?? {};
  const customerName = String(body.customerName ?? '').trim();
  const customerPhone = String(body.customerPhone ?? '').trim();
  const garmentType = String(body.garmentType ?? '').trim();
  const totalAmount = Number(body.totalAmount);
  const deliveryDate = String(body.deliveryDate ?? '').trim();
  const advancePayment = Number(body.advancePayment ?? 0);

  // Check everything before touching the database, so a bad form submission
  // cannot leave half an order behind.
  const problems = [];
  if (!customerName) problems.push('Customer name is required');
  if (!customerPhone) problems.push('Customer phone is required');
  if (!garmentType) problems.push('Garment type is required');
  if (!(totalAmount > 0)) problems.push('Total amount must be more than 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) problems.push('Delivery date is required');
  if (deliveryDate && deliveryDate <= new Date().toISOString().slice(0, 10)) {
    problems.push('Delivery date must be in the future');
  }
  if (advancePayment < 0) problems.push('Advance cannot be negative');
  if (advancePayment > totalAmount) problems.push('Advance cannot be more than the total');
  if (problems.length > 0) {
    return response.status(400).json({ error: 'Please fix these', details: problems });
  }

  // Same phone number means the same person, so returning customers are reused
  // rather than duplicated.
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .upsert({ name: customerName, phone: customerPhone }, { onConflict: 'phone' })
    .select('id, name, phone')
    .single();
  if (customerError) throw customerError;

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      customer_id: customer.id,
      garment_type: garmentType,
      description: String(body.description ?? '').trim() || null,
      total_amount: totalAmount,
      delivery_date: deliveryDate,
    })
    .select('id, garment_type, status, total_amount, delivery_date, public_token, created_at')
    .single();
  if (orderError) throw orderError;

  if (advancePayment > 0) {
    const { error: paymentError } = await supabase
      .from('payments')
      .insert({ order_id: order.id, amount: advancePayment, method: body.method ?? 'CASH' });
    if (paymentError) throw paymentError;
  }

  // One day before delivery, but never a time that has already passed - an
  // order taken in today for tomorrow would otherwise be scheduled yesterday.
  const oneDayBefore = new Date(Date.parse(`${deliveryDate}T00:00:00Z`) - 86400000);
  const reminderTime = oneDayBefore > new Date() ? oneDayBefore : new Date();
  const { error: reminderError } = await supabase
    .from('reminders')
    .insert({ order_id: order.id, type: 'delivery', scheduled_at: reminderTime.toISOString() });
  if (reminderError) throw reminderError;

  return response.status(201).json({
    success: true,
    order: {
      id: order.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      garmentType: order.garment_type,
      status: order.status,
      totalAmount: money(order.total_amount),
      advancePaid: money(advancePayment),
      balanceDue: money(totalAmount - advancePayment),
      deliveryDate: order.delivery_date,
      publicToken: order.public_token,
      trackingPath: `/?token=${order.public_token}`,
    },
  });
}
