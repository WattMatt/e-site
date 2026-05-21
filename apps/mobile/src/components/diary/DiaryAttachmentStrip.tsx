import { useEffect, useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal, Linking, ScrollView } from 'react-native'
import { diaryService } from '@esite/shared'
import type { DiaryAttachment } from '@esite/shared'
import { useSupabase } from '../../providers/SupabaseProvider'
import { colors, radius, spacing } from '../../theme'

interface Props { entryId: string }

interface AttachmentView extends DiaryAttachment { url: string }

export function DiaryAttachmentStrip({ entryId }: Props) {
  const client = useSupabase()
  const [items, setItems] = useState<AttachmentView[]>([])
  const [viewer, setViewer] = useState<AttachmentView | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const rows = await diaryService.listAttachments(client, [entryId])
      if (rows.length === 0) { if (active) setItems([]); return }
      const signed = (await client.storage
        .from('diary-attachments')
        .createSignedUrls(rows.map(r => r.file_path), 3600)).data ?? []
      const urlByPath = new Map(signed.map(s => [s.path, s.signedUrl]))
      if (active) setItems(rows.map(r => ({ ...r, url: urlByPath.get(r.file_path) ?? '' })))
    })().catch(() => { /* non-blocking */ })
    return () => { active = false }
  }, [entryId, client])

  if (items.length === 0) return null

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
      {items.map(att => (
        <TouchableOpacity
          key={att.id}
          style={styles.tile}
          onPress={() => {
            if (att.kind === 'image') setViewer(att)
            else void Linking.openURL(att.url)
          }}
        >
          {att.kind === 'image'
            ? <Image source={{ uri: att.url }} style={styles.thumb} />
            : <View style={styles.fileTile}><Text style={styles.fileIcon}>{att.kind === 'video' ? '▶' : '📄'}</Text></View>}
        </TouchableOpacity>
      ))}
      <Modal visible={!!viewer} transparent onRequestClose={() => setViewer(null)}>
        <TouchableOpacity style={styles.viewerBg} activeOpacity={1} onPress={() => setViewer(null)}>
          {viewer && <Image source={{ uri: viewer.url }} style={styles.viewerImg} resizeMode="contain" />}
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  strip: { marginTop: spacing.sm },
  tile: { marginRight: spacing.sm },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  fileTile: { width: 72, height: 72, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' },
  fileIcon: { fontSize: 26, color: colors.textMid },
  viewerBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '100%' },
})
