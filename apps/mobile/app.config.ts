import { ExpoConfig, ConfigContext } from 'expo/config'

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'E-Site',
  slug: 'e-site',
  owner: 'esite-co',
  version: '2.0.0',
  runtimeVersion: { policy: 'appVersion' },
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0D0B09',
  },
  assetBundlePatterns: ['**/*'],
  updates: {
    url: `https://u.expo.dev/${process.env.EAS_PROJECT_ID ?? ''}`,
    fallbackToCacheTimeout: 0,
    checkAutomatically: 'ON_LOAD',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.esite.app',
    buildNumber: '1',
    // Required by App Store for any app using camera/photos
    infoPlist: {
      NSCameraUsageDescription:
        'E-Site uses the camera to capture snag photos and QR codes on site.',
      NSPhotoLibraryUsageDescription:
        'E-Site accesses your photo library to attach images to snags and site diary entries.',
      NSPhotoLibraryAddUsageDescription:
        'E-Site saves captured photos to your photo library.',
      NSMicrophoneUsageDescription:
        'E-Site may use the microphone during video capture on site.',
      UIBackgroundModes: ['remote-notification'],
    },
    associatedDomains: ['applinks:e-site.co.za'],
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0D0B09',
    },
    package: 'com.esite.app',
    versionCode: 1,
    permissions: [
      'android.permission.CAMERA',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.VIBRATE',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
    ],
    // Deep link handler for Supabase auth callbacks (magic link, password reset)
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'esite', host: 'login-callback' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-camera',
    'expo-image-picker',
    'expo-updates',
    ['expo-notifications', { icon: './assets/notification-icon.png' }],
    ['expo-build-properties', {
      ios: { newArchEnabled: true },
      android: { newArchEnabled: true },
    }],
    '@powersync/react-native',
    // Detox test infrastructure — only active in debug/test builds
    ...(process.env.EAS_BUILD_PROFILE === 'development' ||
      process.env.NODE_ENV === 'test'
      ? [['@config-plugins/detox', { subdomainPrefix: 'esite' }] as [string, object]]
      : []),
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? process.env.EAS_PROJECT_ID ?? '',
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? process.env.EAS_PROJECT_ID ?? '' },
  },
  scheme: 'esite',
  newArchEnabled: true,
})
