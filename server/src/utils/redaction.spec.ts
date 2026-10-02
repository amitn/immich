import { AssetEditAction } from 'src/dtos/editing.dto.js';
import {
  RedactionFace,
  RedactionOcrBox,
  decideFace,
  describeRedaction,
  getFaceRect,
  getFaceRegions,
  getLinkKeptPeople,
  getLinkRegions,
  getRedactionKey,
  getRedactionPromptList,
  getRedactionScene,
  getTextRegions,
  hasPlateShape,
  isPersonalText,
  isPlate,
  matchPlate,
  toEditedRect,
} from 'src/utils/redaction.js';

const face = (overrides: Partial<RedactionFace> = {}): RedactionFace => ({
  id: 'f1',
  imageWidth: 1000,
  imageHeight: 500,
  boundingBoxX1: 100,
  boundingBoxY1: 100,
  boundingBoxX2: 200,
  boundingBoxY2: 200,
  personId: null,
  personName: null,
  isPet: false,
  identityIds: [],
  ...overrides,
});

/** an axis-aligned OCR box */
const box = (id: string, text: string, x: number, y: number, width: number, height: number): RedactionOcrBox => ({
  id,
  text,
  x1: x,
  y1: y,
  x2: x + width,
  y2: y,
  x3: x + width,
  y3: y + height,
  x4: x,
  y4: y + height,
});

const scene = (vehicle: number, screen = 0, document = 0) => ({ vehicle, screen, document });

describe('redaction', () => {
  describe(getFaceRect.name, () => {
    it('should normalize and pad a face box', () => {
      const rect = getFaceRect(face())!;
      // 100..200 of 1000 wide, padded by 15% of the 0.1 width on each side
      expect(rect.x).toBeCloseTo(0.085);
      expect(rect.width).toBeCloseTo(0.13);
      expect(rect.y).toBeCloseTo(0.17);
      expect(rect.height).toBeCloseTo(0.26);
    });

    it('should clamp a face at the edge and skip boxes without a size', () => {
      expect(getFaceRect(face({ boundingBoxX1: 0, boundingBoxY1: 0 }))).toMatchObject({ x: 0, y: 0 });
      expect(getFaceRect(face({ imageWidth: 0 }))).toBeNull();
      expect(getFaceRect(face({ boundingBoxX2: 100 }))).toBeNull();
    });
  });

  describe(decideFace.name, () => {
    const alice = face({ personId: 'alice', personName: 'Alice', identityIds: ['identity-alice'] });
    const stranger = face({ id: 'f2' });

    it('should blur everyone by default', () => {
      expect(decideFace(alice)).toEqual({ reason: 'person', selected: true });
      expect(decideFace(stranger)).toEqual({ reason: 'unknown', selected: true });
    });

    it('should keep the chosen people, by person or by face identity', () => {
      expect(decideFace(alice, { keep: ['alice'] })).toEqual({ reason: 'kept', selected: false });
      expect(decideFace(alice, { keep: [], keepIdentities: ['identity-alice'] })).toEqual({
        reason: 'kept',
        selected: false,
      });
      expect(decideFace(stranger, { keep: ['alice'] })).toEqual({ reason: 'unknown', selected: true });
    });

    it('should blur only the chosen people', () => {
      expect(decideFace(alice, { only: ['alice'] })).toEqual({ reason: 'person', selected: true });
      expect(decideFace(alice, { only: [], onlyIdentities: ['identity-alice'] })).toMatchObject({ selected: true });
      expect(decideFace(stranger, { only: ['alice'] })).toEqual({ reason: 'notChosen', selected: false });
    });
  });

  describe(getFaceRegions.name, () => {
    it('should never suggest a pet, and say whose face it is', () => {
      const regions = getFaceRegions([
        face({ id: 'dog', isPet: true }),
        face({ id: 'bob', personId: 'p-bob', personName: 'Bob' }),
      ]);
      expect(regions).toEqual([
        expect.objectContaining({
          id: 'face:bob',
          kind: 'face',
          reason: 'person',
          selected: true,
          personId: 'p-bob',
          personName: 'Bob',
        }),
      ]);
    });
  });

  describe(matchPlate.name, () => {
    it.each([
      'AB12 CDE',
      'AB12CDE',
      'AB-123-CD',
      'B MW 1234',
      '1234 BCD',
      '12-345-67',
      '123-45-678',
      '7ABC123',
      'ABC 1234',
    ])('should read %s as a plate format', (text) => {
      expect(matchPlate(text)).toBe('format');
    });

    it.each(['K94 X2Y', 'Z1-A34B'])('should read %s as a generic plate', (text) => {
      expect(matchPlate(text)).toBe('generic');
    });

    it.each(['EXIT', 'Open 9-17', 'Welcome to Rome', '2024', 'A1', 'Platform 12', 'TOTAL 12.50'])(
      'should not read %s as a plate',
      (text) => {
        expect(matchPlate(text)).toBeNull();
      },
    );
  });

  describe(isPlate.name, () => {
    it('should take a known format without CLIP, and a generic plate only on a photo of a vehicle', () => {
      expect(isPlate('format', null)).toBe(true);
      expect(isPlate('generic', null)).toBe(false);
      expect(isPlate('generic', scene(0.5))).toBe(true);
      expect(isPlate('generic', scene(0.1))).toBe(false);
      expect(isPlate('format', scene(0.01))).toBe(false);
      expect(isPlate(null, scene(1))).toBe(false);
    });
  });

  describe(hasPlateShape.name, () => {
    it('should want a wide box', () => {
      const size = { width: 1000, height: 1000 };
      expect(hasPlateShape({ x: 0, y: 0, width: 0.2, height: 0.05 }, size)).toBe(true);
      expect(hasPlateShape({ x: 0, y: 0, width: 0.05, height: 0.2 }, size)).toBe(false);
      expect(hasPlateShape({ x: 0, y: 0, width: 0.05, height: 0.2 })).toBe(true);
    });
  });

  describe(isPersonalText.name, () => {
    it.each([
      'Mr John Smith',
      'jane@example.com',
      '+44 7700 900123',
      '4111 1111 1111 1111',
      'PNR A41NQS',
      'Ticket no 1234567890',
    ])('should find %s personal', (text) => {
      expect(isPersonalText(text)).toBe(true);
    });

    it.each(['Trattoria da Enzo', 'EXIT', 'Via del Corso', 'Gate B12'])('should not find %s personal', (text) => {
      expect(isPersonalText(text)).toBe(false);
    });
  });

  describe(getTextRegions.name, () => {
    const size = { width: 2000, height: 1000 };
    const plate = box('plate', 'AB12 CDE', 0.4, 0.7, 0.1, 0.04);
    const sign = box('sign', 'Trattoria da Enzo', 0.1, 0.1, 0.3, 0.05);
    const email = box('email', 'jane@example.com', 0.1, 0.3, 0.3, 0.04);

    it('should select plates and personal text, and suggest other text', () => {
      const regions = getTextRegions([plate, sign, email], { scene: scene(0.6), size });
      expect(regions.map(({ id, kind, reason, selected }) => ({ id, kind, reason, selected }))).toEqual([
        { id: 'text:plate', kind: 'plate', reason: 'plate', selected: true },
        { id: 'text:sign', kind: 'text', reason: 'other', selected: false },
        { id: 'text:email', kind: 'text', reason: 'personal', selected: true },
      ]);
    });

    it('should keep the text out without text, and the plates out without plates', () => {
      expect(getTextRegions([plate, sign, email], { text: false, scene: scene(0.6), size })).toEqual([
        expect.objectContaining({ kind: 'plate' }),
      ]);
      expect(getTextRegions([plate], { plates: false, scene: scene(0.6), size })).toEqual([
        expect.objectContaining({ kind: 'text', reason: 'other' }),
      ]);
    });

    it('should select all the text of a screen, with the region of the screen', () => {
      const regions = getTextRegions([sign, email], { scene: scene(0, 0.8), size });
      expect(
        regions.filter(({ kind }) => kind === 'text').every(({ reason, selected }) => reason === 'screen' && selected),
      ).toBe(true);
      const screen = regions.find(({ kind }) => kind === 'screen')!;
      expect(screen).toMatchObject({ id: 'screen', selected: true });
      expect(screen.x).toBeLessThan(0.1);
      expect(screen.y + screen.height).toBeGreaterThan(0.34);
    });

    it('should select all the text of a document', () => {
      const regions = getTextRegions([sign], { scene: scene(0, 0, 0.9), size });
      expect(regions).toEqual([expect.objectContaining({ reason: 'document', selected: true })]);
    });
  });

  describe(toEditedRect.name, () => {
    const size = { width: 1000, height: 500 };
    const rect = { x: 0.1, y: 0.2, width: 0.2, height: 0.2 };

    it('should keep a rectangle of an unedited photo', () => {
      const kept = toEditedRect(rect, [], size)!;
      expect(kept.x).toBeCloseTo(rect.x);
      expect(kept.y).toBeCloseTo(rect.y);
      expect(kept.width).toBeCloseTo(rect.width);
      expect(kept.height).toBeCloseTo(rect.height);
    });

    it('should move a rectangle with a crop', () => {
      const edited = toEditedRect(
        rect,
        [{ action: AssetEditAction.Crop, parameters: { x: 50, y: 50, width: 500, height: 250 } }],
        size,
      )!;
      // x: (100 - 50) / 500, y: (100 - 50) / 250
      expect(edited.x).toBeCloseTo(0.1);
      expect(edited.y).toBeCloseTo(0.2);
      expect(edited.width).toBeCloseTo(0.4);
      expect(edited.height).toBeCloseTo(0.4);
    });

    it('should turn a rectangle with a rotation, and drop one the crop left out', () => {
      const turned = toEditedRect(rect, [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }], size)!;
      // the left of the photo is now its top
      expect(turned.width).toBeCloseTo(0.2);
      expect(turned.height).toBeCloseTo(0.2);
      expect(turned.y).toBeCloseTo(0.1);
      expect(
        toEditedRect(
          rect,
          [{ action: AssetEditAction.Crop, parameters: { x: 600, y: 0, width: 400, height: 500 } }],
          size,
        ),
      ).toBeNull();
    });
  });

  describe(getRedactionScene.name, () => {
    it('should sum the probabilities of the prompts of each kind', () => {
      const prompts = getRedactionPromptList();
      const similarities = prompts.map(({ kind }) => (kind === 'vehicle' ? 0.3 : 0.2));
      const result = getRedactionScene(similarities)!;
      expect(result.vehicle).toBeGreaterThan(0.9);
      expect(result.screen + result.document).toBeLessThan(0.1);
      expect(getRedactionScene([0.1])).toBeNull();
    });
  });

  describe(getLinkKeptPeople.name, () => {
    const counts = [
      { key: 'alice', personIds: ['p-alice', 'p-alice-2'], identityIds: ['alice'], photos: 5 },
      { key: 'p-bob', personIds: ['p-bob'], identityIds: [], photos: 1 },
    ];

    it('should keep the people seen in two photos or more', () => {
      const people = getLinkKeptPeople(counts, 20);
      expect([...people.keep]).toEqual(['p-alice', 'p-alice-2']);
      expect([...people.keepIdentities]).toEqual(['alice']);
    });

    it('should keep everyone named in a small collection', () => {
      expect([...getLinkKeptPeople(counts, 3).keep]).toEqual(['p-alice', 'p-alice-2', 'p-bob']);
    });
  });

  describe(getLinkRegions.name, () => {
    it('should blur the faces of people not kept, and all the text', () => {
      const faces = [
        face({ id: 'a', personId: 'p-alice', personName: 'Alice' }),
        face({ id: 'b' }),
        face({ id: 'c', isPet: true }),
      ];
      const boxes = [box('t', 'Trattoria', 0.1, 0.1, 0.2, 0.05)];
      const people = { keep: ['p-alice'] };
      expect(getLinkRegions({ faces, boxes }, { redactFaces: true, redactText: true }, people)).toHaveLength(2);
      expect(getLinkRegions({ faces, boxes }, { redactFaces: true, redactText: false }, people)).toHaveLength(1);
      expect(getLinkRegions({ faces, boxes }, { redactFaces: false, redactText: true }, people)).toHaveLength(1);
    });
  });

  describe(getRedactionKey.name, () => {
    it('should not depend on the order of the regions, and change with the source, the regions and the style', () => {
      const a = { x: 0.1, y: 0.1, width: 0.1, height: 0.1 };
      const b = { x: 0.5, y: 0.5, width: 0.1, height: 0.1 };
      expect(getRedactionKey('p', [a, b], 'blur')).toBe(getRedactionKey('p', [b, a], 'blur'));
      expect(getRedactionKey('p', [a], 'blur')).not.toBe(getRedactionKey('p', [a, b], 'blur'));
      expect(getRedactionKey('p', [a], 'blur')).not.toBe(getRedactionKey('q', [a], 'blur'));
      expect(getRedactionKey('p', [a], 'blur')).not.toBe(getRedactionKey('p', [a], 'pixelate'));
    });
  });

  describe(describeRedaction.name, () => {
    it('should count the regions by kind', () => {
      expect(describeRedaction([{ kind: 'face' }, { kind: 'face' }, { kind: 'plate' }, {}])).toBe(
        '2 faces, 1 number plate, 1 area',
      );
    });
  });
});
