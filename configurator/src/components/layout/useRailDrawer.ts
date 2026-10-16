import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The phone drawer's state. It is out only while the page it was opened on is
 * still showing, so picking a link closes it; Escape closes it too.
 */
export function useRailDrawer() {
  const location = useLocation();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === location.pathname;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenedOn(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return {
    open,
    openDrawer: () => setOpenedOn(location.pathname),
    closeDrawer: () => setOpenedOn(null),
  };
}
