import { View, Text, StyleSheet } from 'react-native';

import CreateScreen from './src/CreateScreen';
import ReadScreen from './src/ReadScreen';

/**
 * Навигации нет: экран выбирается по window.location.pathname.
 * "" и "/" — создание секрета, "/s/<id>" — чтение.
 */
export default function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const match = /^\/s\/([^/]+)\/?$/.exec(path);
  if (match) {
    return <ReadScreen id={match[1] as string} />;
  }
  if (path !== '/' && path !== '') {
    return (
      <View style={[styles.root, styles.content]}>
        <Text style={styles.title}>momentum</Text>
        <Text style={styles.text}>Страница не найдена.</Text>
      </View>
    );
  }
  return <CreateScreen />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f4f4f7',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#16161d',
  },
  text: {
    fontSize: 14,
    color: '#5c5c66',
  },
});
