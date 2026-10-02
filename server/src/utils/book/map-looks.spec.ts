import { bookStylePresets, resolveBookStyle } from 'src/dtos/book.dto.js';
import { bookMapLooks, getMapLook, resolveMapLook } from 'src/utils/book/map-looks.js';
import { getContrast } from 'src/utils/book/render.js';

const preset = (id: string) => resolveBookStyle(bookStylePresets[id].style);
const style = (background: string, fontFamily = 'serif') =>
  resolveBookStyle({ background, fontFamily, textColor: '#333333' });

describe('map looks', () => {
  describe('resolveMapLook', () => {
    it.each([
      ['classic', 'engraved'],
      ['soft', 'wash'],
      ['bold', 'minimal'],
      ['food', 'wash'],
      ['cookbook', 'wash'],
      ['wine', 'engraved'],
      ['museum', 'minimal'],
      ['travel', 'vintage'],
    ])('should draw %s books as %s maps', (id, look) => {
      expect(resolveMapLook(preset(id))).toBe(look);
    });

    it('should pick a look for a user style from its paper and font', () => {
      expect(resolveMapLook(style('#f5ecd8'))).toBe('wash');
      expect(resolveMapLook(style('#ffffff'))).toBe('engraved');
      expect(resolveMapLook(style('#ffffff', 'Helvetica, sans-serif'))).toBe('minimal');
      expect(resolveMapLook(style('#15171c'))).toBe('minimal');
    });

    it('should let the user choose the look', () => {
      expect(resolveMapLook(preset('travel'), 'wash')).toBe('wash');
      expect(resolveMapLook(preset('travel'), 'auto')).toBe('vintage');
    });
  });

  describe('getMapLook', () => {
    it('should make every look clearly different', () => {
      const style = preset('classic');
      const looks = bookMapLooks.map((id) => getMapLook(id, style));
      expect(new Set(looks.map((look) => `${look.paper}/${look.land}/${look.sea.color}`)).size).toBe(4);
      expect(looks.find((look) => look.id === 'wash')?.wobble).toBeGreaterThan(0);
      expect(looks.find((look) => look.id === 'engraved')?.waterLines).toBeDefined();
      expect(looks.find((look) => look.id === 'engraved')?.hatch).toBeDefined();
      expect(looks.find((look) => look.id === 'minimal')?.grain).toBe(false);
      expect(looks.find((look) => look.id === 'vintage')?.graticule).toBeDefined();
      expect(looks.find((look) => look.id === 'vintage')?.compass).toBe('rose');
    });

    it("should draw with the book's colours and fonts", () => {
      const travel = getMapLook('vintage', preset('travel'));
      expect(travel.paper).toBe('#f4efe3');
      expect(travel.labels.color).toBe('#1f2f4a');
      expect(travel.overlay.route).toBe('#b0412e');

      const wine = getMapLook('engraved', preset('wine'));
      expect(wine.overlay.route).toBe('#6d1a2c');
      expect(wine.labels.font).toContain('FreeSerif');

      const gallery = getMapLook('minimal', preset('museum'));
      expect(gallery.paper).toBe('#fbfaf7');
      expect(gallery.labels.font).toContain('sans-serif');
    });

    it('should keep the route and the labels readable on a dark page', () => {
      const look = getMapLook('minimal', resolveBookStyle({ background: '#15171c', textColor: '#e8e8e8' }));
      expect(getContrast(look.overlay.route, look.paper)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(look.labels.color, look.paper)).toBeGreaterThanOrEqual(3);
    });
  });
});
