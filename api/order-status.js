import { supabase, nextStage, tailorIsAllowed } from '../lib/tailortrack.js';

/**
 * PUT /api/order-status?id=ORDER_ID   body: { "status": "CUTTING" }
 *
 * Moves an order to the next stage. Only forward, and only one step at a
 * time: RECEIVED -> CUTTING -> STITCHING -> TRIAL -> READY -> DELIVERED.
 * Anything else is refused, so a mis-click cannot skip the trial fitting or
 * quietly reopen a delivered order.
 */
export default async function handler(request, response) {
  try {
    if (request.method !== 'PUT' && request.method !== 'POST') {
      return response.status(405).json({ error: 'Use PUT' });
    }

    if (!tailorIsAllowed(request)) {
      return response.status(401).json({ error: 'Wrong passcode' });
    }

    const orderId = request.query.id;
    const requestedStatus = (request.body ?? {}).status;

    if (!orderId) {
      return response.status(400).json({ error: 'Add ?id=ORDER_ID to the URL' });
    }
    if (!requestedStatus) {
      return response.status(400).json({ error: 'Send a status in the body' });
    }

    const { data: order, error: findError } = await supabase
      .from('orders')
      .select('id, garment_type, status, delivery_date, customers(name)')
      .eq('id', orderId)
      .maybeSingle();
    if (findError) throw findError;

    if (!order) {
      return response.status(404).json({ error: 'Order not found' });
    }

    const allowed = nextStage(order.status);

    if (allowed === null) {
      return response.status(400).json({
        error: `This order is already ${order.status}. There is no next stage.`,
      });
    }
    if (requestedStatus !== allowed) {
      return response.status(400).json({
        error: `Invalid status transition. Current: ${order.status}. Next allowed: ${allowed}`,
      });
    }

    // The status is in the WHERE clause as well as the SET, so if the button
    // was double-tapped the second update matches nothing instead of
    // advancing the order twice.
    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({ status: requestedStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('status', order.status)
      .select('id, status, updated_at')
      .maybeSingle();
    if (updateError) throw updateError;

    if (!updated) {
      return response.status(400).json({
        error: 'That order just changed. Refresh the page and try again.',
      });
    }

    return response.status(200).json({
      success: true,
      order: {
        id: updated.id,
        garmentType: order.garment_type,
        customerName: order.customers?.name ?? 'Unknown',
        previousStatus: order.status,
        currentStatus: updated.status,
        nextStatus: nextStage(updated.status),
        deliveryDate: order.delivery_date,
        updatedAt: updated.updated_at,
      },
    });
  } catch (error) {
    console.error('[/api/order-status] failed:', error);
    return response.status(500).json({ error: 'Something went wrong on the server' });
  }
}
