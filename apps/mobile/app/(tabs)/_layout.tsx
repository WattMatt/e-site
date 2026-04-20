import { Tabs } from 'expo-router'
import { colors } from '../../src/theme'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.amber,
        tabBarInactiveTintColor: colors.textDim,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      {/* tabBarTestID is a React Navigation BottomTab prop used by Detox; cast needed because Expo Router's TabsProps doesn't expose it */}
      <Tabs.Screen name="dashboard"  options={{ title: 'Dashboard',  tabBarTestID: 'tab-dashboard' } as any} />
      <Tabs.Screen name="projects"   options={{ title: 'Projects',   tabBarTestID: 'tab-projects' } as any} />
      <Tabs.Screen name="snags"      options={{ title: 'Snags',      tabBarTestID: 'tab-snags' } as any} />
      <Tabs.Screen name="compliance" options={{ title: 'Compliance', tabBarTestID: 'tab-compliance' } as any} />
    </Tabs>
  )
}
