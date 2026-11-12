import { namesOnPaper, sameDriverName } from './poa-match';

describe('power of attorney names against the driver list', () => {
  it.each([
    ['Naximov Ilxomjon', 'Nahimov Ilhom'],
    ['Pulatov Husniddin', 'Pulatov Xusniddin'],
    ['Kadirov Vaxid', 'Qodirov Abduvohid'],
    ['Karimov Nadir', 'Karimov Nodir'],
    ['Ergashev Alibek', 'Ergashev Ali'],
    ['Toshev Og‘Abek', 'Toshev Ogabek'],
    ['Nabiyev Xikmatilla', 'Nabiyev Hikmatilla'],
    ['Nurullayev Baxodir', 'Nurullayev Bahodir'],
    ['Abdurazakov Xamidjon', 'Abdurazakov Hamid'],
    ['Olimov Javohir', 'Olimov Javohir'],
  ])('%s is %s', (paper, driver) => {
    expect(sameDriverName(paper, driver)).toBe(true);
  });

  it.each([
    ['Mirzayev Elbek', 'Rustamov Shoxrux'],
    ['Boboyev Abdunazar', 'Fayzullayev Yunus'],
    ['Ruziyev Nurmuhammad', 'Nahimov Ilhom'],
    ['Pulatov Husniddin', 'Karimov Azizjon'],
  ])('%s is not %s', (paper, driver) => {
    expect(sameDriverName(paper, driver)).toBe(false);
  });

  it('reads one name per comma and drops the date in brackets', () => {
    expect(namesOnPaper('Pulatov Husniddin, Mirzayev Elbek (12.02.2027)')).toEqual(['Pulatov Husniddin', 'Mirzayev Elbek']);
  });
});
