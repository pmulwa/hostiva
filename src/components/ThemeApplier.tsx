import { useTheme } from '@/hooks/useTheme';

/**
 * Headless component that ensures the user's theme preference is applied
 * globally, regardless of which page they land on. Mounted once at the
 * root of the app.
 */
export const ThemeApplier = () => {
  // Calling the hook is enough — it reads localStorage on init, hydrates from
  // the DB, applies the class to <html> on every change and listens to OS
  // changes when in "system" mode.
  useTheme();
  return null;
};