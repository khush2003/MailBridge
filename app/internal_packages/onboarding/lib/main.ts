import { WorkspaceStore, ComponentRegistry } from 'mailspring-exports';
import OnboardingRoot from './onboarding-root';

export function activate() {
  WorkspaceStore.defineSheet('Main', { root: true }, { list: ['Center'] });

  AppEnv.themes.forceBaseTheme();

  ComponentRegistry.register(OnboardingRoot, {
    location: WorkspaceStore.Location.Center,
  });


}

export function deactivate() {}

export function serialize() {}
