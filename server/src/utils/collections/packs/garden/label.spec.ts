import {
  findCrop,
  formatPlantName,
  parsePlantLabel,
  parsePlantName,
  readPlantLabel,
} from 'src/utils/collections/packs/garden/label.js';

const box = (text: string, top: number, height = 0.035, score = 0.97) => {
  const width = Math.min(0.9, text.length * height * 0.45);
  const left = 0.3;
  return {
    x1: left,
    y1: top,
    x2: left + width,
    y2: top,
    x3: left + width,
    y3: top + height,
    x4: left,
    y4: top + height,
    text,
    textScore: score,
  };
};

const packet = (crop: string, variety: string) => [
  box('UH SEED LAB', 0.1, 0.044),
  box('College of Tropical Agriculture and Human Resources', 0.17),
  box('University of Hawaii at Manoa', 0.22, 0.03),
  box(crop, 0.25, 0.066),
  box(variety, 0.31, 0.068),
  box('Net. Wt. Packed For: 2008', 0.41, 0.047, 0.64),
  box('1910 East West Road, Sherman Lab Rm. #134, Honolulu, HI. 96822', 0.49, 0.03),
];

describe('garden labels', () => {
  it('should read the crop, even cut at the edge of the photo', () => {
    expect(findCrop('LETTUCE')).toBe('lettuce');
    expect(findCrop('LOWER')).toBe('cauliflower');
    expect(findCrop('Tomatoe')).toBe('tomato');
    expect(findCrop('University')).toBeUndefined();
  });

  it('should read the variety of a seed packet, not its small print', () => {
    expect(readPlantLabel(packet('LETTUCE', 'ANUENUE'))).toMatchObject({
      crop: 'lettuce',
      variety: 'Anuenue',
      sure: true,
    });
    expect(parsePlantLabel(packet('LOWER', 'PUAKEA')).items.map(({ name }) => name)).toEqual(["Cauliflower 'Puakea'"]);
  });

  it('should read a tag with the variety alone, and nothing made up on a scratched metal tag', () => {
    expect(readPlantLabel([box('Tropic', 0.3, 0.1), box('Prince', 0.42, 0.1)])).toMatchObject({
      variety: 'Tropic Prince',
    });
    expect(readPlantLabel([box('Tropic Prince', 0.3, 0.1)])).toMatchObject({ variety: 'Tropic Prince', sure: false });
    expect(readPlantLabel([box('Tnopiepe', 0.37, 0.124, 0.62)])).toBeUndefined();
    expect(parsePlantLabel([])).toMatchObject({ items: [] });
  });

  it('should name a plant "Crop \'Variety\'" and read the name back', () => {
    expect(formatPlantName({ crop: 'peach', variety: 'Tropic Prince' })).toBe("Peach 'Tropic Prince'");
    expect(formatPlantName({ variety: 'Tropic Prince' })).toBe('Tropic Prince');
    expect(parsePlantName("Peach 'Tropic Prince'")).toEqual({ crop: 'Peach', variety: 'Tropic Prince' });
  });
});
