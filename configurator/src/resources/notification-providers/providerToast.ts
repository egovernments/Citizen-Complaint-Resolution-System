// Shadcn toast wrapper shared by the Providers screen's dialogs — the app mounts
// <Toaster/> at its root.
import { toast } from '@/hooks/use-toast';

export function notify(title: string, description?: string, variant?: 'default' | 'destructive') {
  toast({ title, description, variant });
}
