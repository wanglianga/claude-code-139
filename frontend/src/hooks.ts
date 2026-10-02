import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export function useLoader<T>(path: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    api('GET', path)
      .then((d) => {
        setData(d);
        setErr('');
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  return { data, err, loading, reload, setData };
}
