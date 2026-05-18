import { Modal, View, TextInput, Button, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import { useRef, useState } from 'react';

export interface SignaturePayload {
  base64DataUrl: string;          // image/png;base64,...
  signatoryName: string;
  signatoryTitle: string;
  signatoryRegNumber?: string;
}

interface Props {
  visible: boolean;
  requiredQualifications?: string[];   // ['registered_person', 'master_installation_electrician', ...]
  onCapture: (payload: SignaturePayload) => void;
  onCancel: () => void;
}

export function SignaturePadModal({ visible, requiredQualifications: _requiredQualifications, onCapture, onCancel }: Props) {
  const ref = useRef<SignatureViewRef>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [regNumber, setRegNumber] = useState('');

  const handleConfirm = () => ref.current?.readSignature();
  const handleSignature = (base64DataUrl: string) => {
    onCapture({ base64DataUrl, signatoryName: name.trim(), signatoryTitle: title.trim(), signatoryRegNumber: regNumber.trim() || undefined });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <SignatureScreen ref={ref} onOK={handleSignature} webStyle={`.m-signature-pad--footer {display: none;}`} />
        <View style={styles.metaPanel}>
          <TextInput placeholder="Full name" value={name} onChangeText={setName} style={styles.input} />
          <TextInput placeholder="Title (e.g. Registered Person)" value={title} onChangeText={setTitle} style={styles.input} />
          <TextInput placeholder="Registration number (if applicable)" value={regNumber} onChangeText={setRegNumber} style={styles.input} />
          <View style={styles.buttonRow}>
            <Button title="Cancel" onPress={onCancel} />
            <Button title="Capture" onPress={handleConfirm} disabled={!name.trim() || !title.trim()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  metaPanel: { padding: 16, gap: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 12, fontSize: 16 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
});
