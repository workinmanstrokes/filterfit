import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.workinmanstrokes.filterfit',
  appName: 'FilterFit',
  webDir: 'dist',
  backgroundColor: '#0f172a',
  android: {
    // Android 15+ draws apps edge to edge; keep the web view clear of the
    // status bar and gesture bar so nothing sits underneath them.
    adjustMarginsForEdgeToEdge: 'auto',
  },
  plugins: {
    Camera: {
      permissions: ['camera', 'photos'],
    },
  },
};

export default config;

