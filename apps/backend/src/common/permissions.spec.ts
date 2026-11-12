import { can } from '@bigant/shared';

describe('permission matrix (§5)', () => {
  it('admin can create orders and assign drivers', () => {
    expect(can('admin', 'create_order')).toBe(true);
    expect(can('admin', 'assign_driver')).toBe(true);
  });

  it('seller can create orders but not driver accounts', () => {
    expect(can('seller', 'create_order')).toBe(true);
    expect(can('seller', 'create_driver_account')).toBe(false);
  });

  it('only admin can create seller accounts (decision #1)', () => {
    expect(can('admin', 'create_seller_account')).toBe(true);
    expect(can('seller', 'create_seller_account')).toBe(false);
  });

  it('driver can accept/reject and collect, but not create orders', () => {
    expect(can('driver', 'accept_reject_order')).toBe(true);
    expect(can('driver', 'mark_product_collected')).toBe(true);
    expect(can('driver', 'create_order')).toBe(false);
  });
});
