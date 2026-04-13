import { View, Text, StyleSheet } from 'react-native'

export default function SnagsTab() {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>Snags — Sprint 1</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  placeholder: { color: '#64748B', fontSize: 16 },
})
