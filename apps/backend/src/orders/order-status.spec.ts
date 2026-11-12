import { canTransitionOrderStatus, CANCELLABLE_ORDER_STATUSES } from '@bigant/shared';

describe('order status state machine', () => {
  it('allows the normal happy path', () => {
    expect(canTransitionOrderStatus('created', 'assigned_to_driver')).toBe(true);
    expect(canTransitionOrderStatus('assigned_to_driver', 'driver_accepted')).toBe(true);
    expect(canTransitionOrderStatus('driver_accepted', 'collecting_items')).toBe(true);
    expect(canTransitionOrderStatus('collecting_items', 'items_collected')).toBe(true);
    expect(canTransitionOrderStatus('items_collected', 'on_the_way')).toBe(true);
    expect(canTransitionOrderStatus('on_the_way', 'delivered')).toBe(true);
  });

  it('routes the on_the_way → arrived_at_customer → delivered journey', () => {
    expect(canTransitionOrderStatus('on_the_way', 'arrived_at_customer')).toBe(true);
    expect(canTransitionOrderStatus('arrived_at_customer', 'delivered')).toBe(true);
    // Legacy direct-deliver from on_the_way stays valid during the app migration.
    expect(canTransitionOrderStatus('on_the_way', 'delivered')).toBe(true);
    // Istisno is reported without changing the order status.
    expect(canTransitionOrderStatus('arrived_at_customer', 'problem')).toBe(false);
  });

  it('keeps arrived_at_customer out of illegal jumps', () => {
    expect(canTransitionOrderStatus('arrived_at_customer', 'on_the_way')).toBe(false);
    expect(canTransitionOrderStatus('items_collected', 'arrived_at_customer')).toBe(false);
    expect(canTransitionOrderStatus('arrived_at_customer', 'cancelled')).toBe(false);
  });

  it('allows a driver rejection to send the order back to created', () => {
    expect(canTransitionOrderStatus('assigned_to_driver', 'created')).toBe(true);
  });

  it('forbids illegal jumps', () => {
    expect(canTransitionOrderStatus('created', 'delivered')).toBe(false);
    expect(canTransitionOrderStatus('created', 'on_the_way')).toBe(false);
    expect(canTransitionOrderStatus('delivered', 'on_the_way')).toBe(false);
    expect(canTransitionOrderStatus('cancelled', 'created')).toBe(false);
  });

  it('supports status-dependent seller cancellation outcomes', () => {
    expect(CANCELLABLE_ORDER_STATUSES).toEqual(
      expect.arrayContaining([
        'created',
        'assigned_to_driver',
        'driver_accepted',
        'collecting_items',
        'items_collected',
        'on_the_way',
        'arrived_at_customer',
      ]),
    );
    // collecting_items may finish as cancelled or enter Vozvrat depending on
    // whether any pickup has already reached Yuk olindi.
    expect(canTransitionOrderStatus('collecting_items', 'cancelled')).toBe(true);
    expect(canTransitionOrderStatus('collecting_items', 'returning')).toBe(true);
    expect(canTransitionOrderStatus('items_collected', 'returning')).toBe(true);
    expect(canTransitionOrderStatus('on_the_way', 'returning')).toBe(true);
    expect(canTransitionOrderStatus('arrived_at_customer', 'returning')).toBe(true);
    expect(canTransitionOrderStatus('delivered', 'cancelled')).toBe(false);
  });

  it('treats delivered, cancelled and problem as terminal', () => {
    expect(canTransitionOrderStatus('delivered', 'problem')).toBe(false);
    expect(canTransitionOrderStatus('cancelled', 'problem')).toBe(false);
    expect(canTransitionOrderStatus('problem', 'collecting_items')).toBe(false);
  });
});

describe('vozvrat order transitions', () => {
  it('skips collecting: accepted → on the way, only for a vozvrat order', () => {
    expect(canTransitionOrderStatus('driver_accepted', 'on_the_way', 'vozvrat')).toBe(true);
    expect(canTransitionOrderStatus('driver_accepted', 'on_the_way')).toBe(false);
    expect(canTransitionOrderStatus('driver_accepted', 'on_the_way', 'delivery')).toBe(false);
    expect(canTransitionOrderStatus('on_the_way', 'delivered', 'vozvrat')).toBe(true);
  });
});
