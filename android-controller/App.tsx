import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

type Task = {
  id: string;
  instruction: string;
  status: string;
  preview?: { action?: string; scope?: string; permission?: string; impact?: string };
  result?: { content?: string } | null;
};

const colors = { bg: '#0b1117', surface: '#121e24', surface2: '#18272d', line: '#30454b', text: '#e6f0ec', muted: '#8ba1a2', lime: '#c8f169', amber: '#efb25c', coral: '#ff8177' };

export default function App() {
  const [baseUrl, setBaseUrl] = useState('http://192.168.1.24:8228');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('My Android');
  const [instruction, setInstruction] = useState('');
  const [token, setToken] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [message, setMessage] = useState('Enter the PC IP and pairing code shown in its terminal.');

  const headers = useMemo(() => ({ 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }), [token]);
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const refresh = async () => {
    if (!token) return;
    try { const data = await request('/api/tasks'); setTasks(data.tasks || []); setMessage('Connected to local agent.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Connection failed'); }
  };

  useEffect(() => { if (!token) return; refresh(); const timer = setInterval(refresh, 1800); return () => clearInterval(timer); }, [token]);

  const pair = async () => {
    try { const data = await request('/api/pairing/confirm', { method: 'POST', body: JSON.stringify({ code, deviceName }) }); setToken(data.token); setMessage(`Paired as ${data.device.name}.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Pairing failed'); }
  };
  const send = async () => {
    if (!instruction.trim()) return;
    try { await request('/api/tasks', { method: 'POST', body: JSON.stringify({ instruction, requestedTools: ['file.list'], relativePath: '.' }) }); setInstruction(''); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create task'); }
  };
  const act = async (id: string, action: string) => { try { await request(`/api/tasks/${id}/${action}`, { method: 'POST', body: '{}' }); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Action failed'); } };

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container}>
    <View style={styles.header}><View style={styles.brandRow}><View style={styles.mark} /><Text style={styles.brand}>ChDevAgent<Text style={{ color: colors.lime }}>.</Text></Text></View><Text style={styles.status}>{token ? '● ONLINE' : '○ OFFLINE'}</Text></View>
    <Text style={styles.eyebrow}>MOBILE CONTROLLER / LOCAL LAN</Text><Text style={styles.title}>Your phone.{"\n"}<Text style={{ color: colors.lime }}>Your command.</Text></Text><Text style={styles.lede}>Pair once with the PC agent, then review every local action before it runs.</Text>
    {!token ? <View style={styles.card}><View style={styles.cardHead}><Text style={styles.cardTitle}>Pair this device</Text><Text style={styles.cardMeta}>01 / IDENTITY</Text></View><Text style={styles.label}>PC address</Text><TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" style={styles.input} placeholder="http://192.168.1.24:8228" placeholderTextColor="#647b7c" /><Text style={styles.label}>Pairing code</Text><TextInput value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} style={styles.input} placeholder="123456" placeholderTextColor="#647b7c" /><TextInput value={deviceName} onChangeText={setDeviceName} style={styles.input} placeholder="Device name" placeholderTextColor="#647b7c" /><TouchableOpacity style={styles.primary} onPress={pair}><Text style={styles.primaryText}>CONNECT TO LOCAL AGENT</Text></TouchableOpacity><Text style={styles.hint}>{message}</Text></View> : <View style={styles.card}><View style={styles.cardHead}><Text style={styles.cardTitle}>Command center</Text><Text style={styles.cardMeta}>LOCAL WORKSPACE</Text></View><View style={styles.commandRow}><TextInput value={instruction} onChangeText={setInstruction} onSubmitEditing={send} style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="Tell the agent what to do..." placeholderTextColor="#647b7c" /><TouchableOpacity style={styles.primarySmall} onPress={send}><Text style={styles.primaryText}>SEND</Text></TouchableOpacity></View><Text style={styles.hint}>{message}</Text>{tasks.length === 0 ? <Text style={styles.empty}>No tasks yet. Start with a read-only workspace request.</Text> : tasks.map(task => <View key={task.id} style={styles.task}><View style={styles.taskTop}><Text style={styles.taskId}>{task.id}</Text><Text style={[styles.badge, task.status === 'succeeded' || task.status === 'approved' ? styles.good : task.status === 'rejected' || task.status === 'failed' ? styles.bad : null]}>{task.status.replaceAll('_', ' ')}</Text></View><Text style={styles.taskTitle}>{task.instruction}</Text><View style={styles.preview}><Text style={styles.previewTitle}>BEFORE ANYTHING RUNS</Text><Text style={styles.previewText}>{task.preview?.action || 'Local action preview'}</Text><Text style={styles.previewMeta}>{task.preview?.scope || '/workspace'} · {task.preview?.permission || 'read-only'}</Text></View>{task.result?.content ? <Text style={styles.result}>{task.result.content}</Text> : null}{task.status === 'awaiting_approval' ? <View style={styles.actions}><TouchableOpacity style={styles.primarySmall} onPress={() => act(task.id, 'approve')}><Text style={styles.primaryText}>APPROVE</Text></TouchableOpacity><TouchableOpacity style={styles.reject} onPress={() => act(task.id, 'reject')}><Text style={styles.rejectText}>REJECT</Text></TouchableOpacity></View> : null}</View>)}</View>}
    <Text style={styles.footer}>LOCAL / PRIVATE / OPEN · ChDevAgent MVP</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, container: { padding: 20, paddingBottom: 48 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 22, borderBottomWidth: 1, borderBottomColor: '#1e343a' }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, mark: { width: 24, height: 24, borderWidth: 2, borderColor: colors.lime, borderRightColor: 'transparent', borderRadius: 7 }, brand: { color: colors.text, fontSize: 17, fontWeight: '700' }, status: { color: colors.lime, fontSize: 10, letterSpacing: 1 }, eyebrow: { color: colors.lime, fontSize: 10, letterSpacing: 2, marginTop: 28 }, title: { color: colors.text, fontSize: 47, lineHeight: 46, fontWeight: '700', letterSpacing: -3, marginTop: 16 }, lede: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: 13 }, card: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 16, marginTop: 26 }, cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 17 }, cardTitle: { color: colors.text, fontSize: 20, fontWeight: '700' }, cardMeta: { color: '#7a9292', fontSize: 9, letterSpacing: 1 }, label: { color: '#9eb2af', fontSize: 10, letterSpacing: 1, marginBottom: 8, marginTop: 8 }, input: { backgroundColor: '#0e191f', borderWidth: 1, borderColor: '#3d565b', color: colors.text, paddingHorizontal: 12, paddingVertical: 12, fontSize: 13, marginBottom: 10 }, primary: { backgroundColor: colors.lime, padding: 14, alignItems: 'center', marginTop: 4 }, primarySmall: { backgroundColor: colors.lime, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#132017', fontSize: 10, fontWeight: '700', letterSpacing: .5 }, hint: { color: colors.muted, fontSize: 12, marginTop: 11, lineHeight: 18 }, commandRow: { flexDirection: 'row', gap: 8, alignItems: 'center' }, empty: { color: '#789092', fontSize: 12, marginTop: 24 }, task: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, padding: 15, marginTop: 16 }, taskTop: { flexDirection: 'row', justifyContent: 'space-between' }, taskId: { color: '#7d9696', fontSize: 10 }, badge: { color: colors.amber, fontSize: 10, textTransform: 'uppercase' }, good: { color: colors.lime }, bad: { color: colors.coral }, taskTitle: { color: colors.text, fontSize: 15, lineHeight: 21, marginTop: 16 }, preview: { borderLeftWidth: 2, borderLeftColor: colors.amber, backgroundColor: '#211e17', padding: 11, marginTop: 14 }, previewTitle: { color: colors.amber, fontSize: 9, letterSpacing: 1, marginBottom: 4 }, previewText: { color: '#c7cfbd', fontSize: 12, lineHeight: 18 }, previewMeta: { color: '#91a6a2', fontSize: 10, marginTop: 6 }, result: { color: colors.lime, fontSize: 12, lineHeight: 18, marginTop: 13 }, actions: { flexDirection: 'row', gap: 8, marginTop: 15 }, reject: { flex: 1, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#70413f' }, rejectText: { color: colors.coral, fontSize: 10, fontWeight: '700' }, footer: { color: '#63787b', fontSize: 10, letterSpacing: 1, marginTop: 36, textAlign: 'center' } });
