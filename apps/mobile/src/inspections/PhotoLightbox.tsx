// apps/mobile/src/inspections/PhotoLightbox.tsx
//
// Full-screen photo lightbox for the mobile inspection capture screen.
// Supports swipe-paging between multiple photos via FlatList + pagingEnabled.
// Tapping the backdrop or the × button closes; tapping the image itself does NOT close.
// Shows EXIF taken_at as a caption when available, formatted for en-ZA locale.

import { Dimensions, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'

export interface LightboxPhoto {
  id: string
  uri: string // file:// URI (local) or signed https:// URL (remote)
  taken_at?: string | null
}

interface Props {
  photos: LightboxPhoto[]
  activeIndex: number
  visible: boolean
  onClose: () => void
}

export function PhotoLightbox({ photos, activeIndex, visible, onClose }: Props) {
  const { width, height } = Dimensions.get('window')

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Backdrop — tap to close */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          initialScrollIndex={activeIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(p) => p.id}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            /* Inner Pressable stops the tap propagating to the backdrop */
            <Pressable onPress={(e) => e.stopPropagation()} style={{ width }}>
              <Image
                source={{ uri: item.uri }}
                style={{ width, height: height * 0.82, resizeMode: 'contain' }}
              />
              {item.taken_at ? (
                <Text style={styles.caption}>
                  {new Date(item.taken_at).toLocaleString('en-ZA')}
                </Text>
              ) : null}
            </Pressable>
          )}
        />

        {/* Close button — always on top */}
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
  },
  caption: {
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    paddingVertical: 8,
    fontSize: 12,
  },
  closeBtn: {
    position: 'absolute',
    top: 44,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: 'white',
    fontSize: 18,
    lineHeight: 20,
  },
})
