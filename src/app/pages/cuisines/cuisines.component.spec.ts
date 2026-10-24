import { groupByRegion } from './cuisines.component';

describe('groupByRegion', () => {
  it('orders regions by the content schema and cuisines alphabetically', () => {
    const c = (name: string, region: string | null) => ({ name, slug: name.toLowerCase(), region, count: 1, image: '' });
    const groups = groupByRegion([c('Thai', 'Southeast Asia'), c('Algerian', 'North Africa & Middle East'), c('Moroccan', 'North Africa & Middle East'), c('Mystery', null)]);
    expect(groups.map(g => g.region)).toEqual(['North Africa & Middle East', 'Southeast Asia', 'Other']);
    expect(groups[0].cuisines.map(x => x.name)).toEqual(['Algerian', 'Moroccan']);
  });
});
