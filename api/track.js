import { supabase, daysBetween, money, stepOf, timelineFor, today } from '../lib/tailortrack.js';

/**
 * GET /api/track?token=PUBLIC_TOKEN
 *
 * The customer's view. No passcode: the token in their link is what proves
 * they own the order, and it is a random UUID so it cannot be guessed.
 *
 * Only what a customer needs is selected. Their phone number and address are
 * never read from the database here, so they cannot end up in the response.
 */
export default async function handler(request, response) {
  try {
    if (request.method !== 'GET') {
      return response.status(405).json({ error: 'Use GET' });
    }

    const token = request.query.token;
    if (!token) {
      return response.status(400).json({ error: 'No tracking token in the link' });
    }

    const { data: order, error } = await supabase
      .from('orders')
      .select('garment_type, description, status, total_amount, delivery_date, customers(name), payments(amount, method, paid_at)')
      .eq('public_token', token)
      .maybeSingle();
    if (error) throw error;

    if (!order) {
      return response
        .status(404)
        .json({ error: 'Order not found. Please check your link or contact the shop.' });
    }

    const { data: shop } = await supabase
      .from('shop')
      .select('name, phone, address')
      .eq('id', 1)
      .maybeSingle();

    const totalAmount = money(order.total_amount);
    const totalPaid = order.payments.reduce((sum, payment) => sum + money(payment.amount), 0);
    const daysRemaining = daysBetween(today(), order.delivery_date);

    return response.status(200).json({
      success: true,
      order: {
        garmentType: order.garment_type,
        description: order.description,
        customerName: order.customers?.name ?? '',
        status: order.status,
        statusStep: stepOf(order.status),
        totalSteps: 6,
        deliveryDate: order.delivery_date,
        // Late only matters while the garment is still with the shop.
        isOverdue: daysRemaining < 0 && order.status !== 'DELIVERED',
        daysRemaining,
        payment: {
          totalAmount,
          totalPaid: money(totalPaid),
          balanceDue: money(totalAmount - totalPaid),
        },
        shop: shop ?? { name: 'Our Shop', phone: '', address: '' },
        timeline: timelineFor(order.status),
      },
    });
  } catch (error) {
    console.error('[/api/track] failed:', error);
    return response.status(500).json({ error: 'Something went wrong on the server' });
  }
}
