import { DeviceStateService } from './device-state.service';

function make(onShift = true) {
  const prisma = {
    driver: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'd1',
        user: { name: 'Bobur' },
        vehicle: { plateNumber: '01 X 111 XX' },
        workLogs: onShift ? [{ id: 'w1' }] : [],
      }),
    },
  };
  const telegram = { send: jest.fn().mockResolvedValue({ skipped: false }) };
  const config = { get: jest.fn().mockReturnValue('-100ops') };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new DeviceStateService(prisma as any, telegram as any, config as any);
  return { svc, telegram };
}

describe('DeviceStateService — the office hears GPS off / battery saver (owner, 10.11.2026)', () => {
  it('location services switched off on shift: one message, not repeated; back on: one more', async () => {
    const { svc, telegram } = make();
    await svc.report('u1', { gps_off: true });
    await svc.report('u1', { gps_off: true });
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(telegram.send.mock.calls[0][0].text).toContain("O'CHIRILDI");
    expect(telegram.send.mock.calls[0][0].text).toContain('Bobur (01 X 111 XX)');
    await svc.report('u1', { gps_off: false });
    expect(telegram.send).toHaveBeenCalledTimes(2);
    expect(telegram.send.mock.calls[1][0].text).toContain('qayta yoqildi');
  });

  it('battery saver on shift: reported', async () => {
    const { svc, telegram } = make();
    await svc.report('u1', { low_power: true });
    expect(telegram.send.mock.calls[0][0].text).toContain('quvvat tejash');
  });

  it('off shift: nothing is sent', async () => {
    const { svc, telegram } = make(false);
    await svc.report('u1', { gps_off: true, low_power: true });
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('the first report saying all is well sends nothing', async () => {
    const { svc, telegram } = make();
    await svc.report('u1', { gps_off: false, low_power: false });
    expect(telegram.send).not.toHaveBeenCalled();
  });
});
