import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.workinmanstrokes.filterfit',
  appName: 'FilterFit',
  webDir: 'dist',
  backgroundColor: '#0f172a',
  plugins: {
    Camera: {
      permissions: ['camera', 'photos'],
    },
  },
};

export default config;

