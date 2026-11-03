export async function retryNotConnectedOnce<C, T>(
  acquire: () => Promise<C>,
  invalidate: (client: C) => Promise<void>,
  invoke: (client: C) => Promise<T>,
): Promise<T> {
  const first = await acquire();
  try {
    return await invoke(first);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Not connected') throw error;
    await invalidate(first);
    const second = await acquire();
    return invoke(second);
  }
}
