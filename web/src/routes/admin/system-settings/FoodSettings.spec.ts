import { toastManager } from '@immich/ui';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { renderWithTooltips } from '$tests/helpers';
import FoodSettings from './FoodSettings.svelte';

const food = vi.hoisted(() => ({
  openStreetMap: { enabled: false, overpassUrl: 'https://overpass-api.de/api/interpreter' },
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: { value: { configFile: false } } as never,
}));

vi.mock(import('$lib/managers/system-config-manager.svelte'), () => ({
  systemConfigManager: {
    value: { food: structuredClone(food) },
    defaultValue: { food: structuredClone(food) },
    cloneValue: () => ({ food: structuredClone(food) }),
  } as never,
}));

describe('FoodSettings component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    sdkMock.getConfig.mockResolvedValue({ food: structuredClone(food) } as never);
    sdkMock.updateConfig.mockImplementation(({ adminConfigDto }) => Promise.resolve(adminConfigDto));
  });

  it('should state that the location of a meal is sent to OpenStreetMap', () => {
    renderWithTooltips(FoodSettings, {});

    expect(screen.getByText('admin.food_open_street_map_privacy_title')).toBeInTheDocument();
    expect(screen.getByText('admin.food_open_street_map_privacy_description')).toBeInTheDocument();
  });

  it('should only edit the Overpass URL when the lookup is on', async () => {
    renderWithTooltips(FoodSettings, {});

    const url = screen.getByRole('textbox', { name: /admin.food_overpass_url/ });
    expect(url).toBeDisabled();
    expect(url).toHaveValue(food.openStreetMap.overpassUrl);

    await fireEvent.click(screen.getByRole('switch'));

    expect(url).toBeEnabled();
  });

  it('should save the lookup and the Overpass URL', async () => {
    renderWithTooltips(FoodSettings, {});

    await fireEvent.click(screen.getByRole('switch'));
    const url = screen.getByRole('textbox', { name: /admin.food_overpass_url/ });
    await fireEvent.input(url, { target: { value: ' https://overpass.example.org/api/interpreter ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(sdkMock.updateConfig).toHaveBeenCalledWith({
        adminConfigDto: {
          food: { openStreetMap: { enabled: true, overpassUrl: 'https://overpass.example.org/api/interpreter' } },
        },
      }),
    );
  });

  it('should not save an Overpass URL that is not a web address', async () => {
    const warning = vi.spyOn(toastManager, 'warning').mockImplementation(() => {});
    renderWithTooltips(FoodSettings, {});

    await fireEvent.click(screen.getByRole('switch'));
    const url = screen.getByRole('textbox', { name: /admin.food_overpass_url/ });
    await fireEvent.input(url, { target: { value: 'overpass' } });
    await fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(warning).toHaveBeenCalledWith('admin.food_overpass_url_invalid'));
    expect(sdkMock.updateConfig).not.toHaveBeenCalled();
  });
});
