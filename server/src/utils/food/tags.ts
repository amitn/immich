/**
 * Food photos are organized with tags, which are the contract between the matcher (that writes them) and photo books
 * (that read them): `Food/<Restaurant>/<Dish>` on a dish photo and `Food/<Restaurant>/Menu` on a photo of the menu.
 */
export const FOOD_TAG_ROOT = 'Food';

/** the leaf that marks a menu photo, instead of a dish name */
export const MENU_TAG_LEAF = 'Menu';

/** tag values are split on "/", so names can't contain one */
const cleanName = (name: string) => name.replaceAll('/', '-').replaceAll(/\s+/g, ' ').trim();

export const getRestaurantTag = (restaurant: string) => `${FOOD_TAG_ROOT}/${cleanName(restaurant)}`;

export const getDishTag = (restaurant: string, dish: string) => {
  const name = cleanName(dish);
  // a dish that happens to be called "Menu" would read as a menu photo
  return `${getRestaurantTag(restaurant)}/${name.toLowerCase() === MENU_TAG_LEAF.toLowerCase() ? `${name} (dish)` : name}`;
};

export const getMenuTag = (restaurant: string) => `${getRestaurantTag(restaurant)}/${MENU_TAG_LEAF}`;

export type FoodTag = { restaurant: string } & ({ kind: 'dish'; dish: string } | { kind: 'menu' });

/** Reads a tag value written by `getDishTag` or `getMenuTag`; anything else is not a food tag. */
export const parseFoodTag = (value: string): FoodTag | undefined => {
  const parts = value.split('/');
  if (parts.length !== 3 || parts[0] !== FOOD_TAG_ROOT || !parts[1] || !parts[2]) {
    return;
  }
  const [, restaurant, leaf] = parts;
  return leaf === MENU_TAG_LEAF ? { restaurant, kind: 'menu' } : { restaurant, kind: 'dish', dish: leaf };
};

/** The description a dish photo gets when it has none yet, e.g. "Spaghetti alle vongole · Trattoria da Nino". */
export const getDishDescription = (restaurant: string, dish: string) => `${dish.trim()} · ${restaurant.trim()}`;
