/**
 * T-055: Detox E2E configuration
 *
 * Runs against the Expo development client (not Expo Go).
 * Requires a running Android emulator or iOS Simulator.
 *
 * Setup:
 *   1. pnpm add -D detox @config-plugins/detox jest jest-circus --filter mobile
 *   2. expo install expo-build-properties
 *   3. Add detox plugin to app.json plugins array (see docs)
 *   4. eas build --profile development --platform android  (first time only)
 *
 * Run (Android):
 *   npx detox build --configuration android.emu.debug
 *   npx detox test --configuration android.emu.debug
 *
 * Run (iOS):
 *   npx detox build --configuration ios.sim.debug
 *   npx detox test --configuration ios.sim.debug
 */

/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120_000,
    },
  },
  apps: {
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: 'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug',
    },
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/esite.app',
      build: 'xcodebuild -workspace ios/esite.xcworkspace -scheme esite -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { type: 'iPhone 15 Pro' },
    },
    emulator: {
      type: 'android.emulator',
      device: { avdName: 'Pixel_7_API_34' },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
  },
}
