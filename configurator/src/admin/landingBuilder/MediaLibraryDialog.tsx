/** Media field + library dialog (P4, CCSD-2009). Reuses the platform
 * document-management flow ONLY: uploads via the existing filestore endpoint
 * (DigitApiClient), previews via filestoreGetUrl; recent assets are a
 * Builder-local convenience. Also accepts a pasted image URL (renders
 * everywhere today; filestore-id delivery on the published page is the P2
 * media phase — stated inline).
 */
import { useRef, useState } from 'react';
import { Image as ImageIcon, Link2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { useApp } from '../../App';
import { useBuilder } from './builderStore';
import { getRecents, isUrl, uploadImage, type MediaAsset } from './media';
import type { BuilderFieldDef } from './sectionEditorRegistry';
import type { LandingSectionData } from './types';

export function MediaLibraryDialog({ def, code, draft }: { def: BuilderFieldDef; code: string; draft: LandingSectionData }) {
  const { dispatch } = useBuilder();
  const { state: app } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const current = draft.media?.imageId;
  const setImage = (imageId?: string) =>
    dispatch({ type: 'patchSection', code, patch: { media: { ...(draft.media ?? {}), imageId } } });

  const pick = (asset: MediaAsset) => {
    // Store URL when we have one (renders everywhere today); else the id.
    setImage(asset.url && isUrl(asset.url) ? asset.url : asset.fileStoreId);
    setOpen(false);
  };

  const onUpload = async (file: File) => {
    setBusy(true);
    try {
      const asset = await uploadImage(app.tenant ?? '', file);
      pick(asset);
      toast({ title: 'Uploaded', description: file.name });
    } catch (e) {
      toast({ title: 'Upload failed', description: String((e as Error)?.message ?? e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const recents = getRecents().filter((a) => !query || a.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-1.5" data-field={def.path}>
      <Label className="text-xs font-medium">{def.label}</Label>
      <div className="flex items-center gap-2 rounded-md border border-border p-2">
        {current && isUrl(current) ? (
          <img src={current} alt="" className="h-10 w-14 rounded object-cover" />
        ) : (
          <span className="flex h-10 w-14 items-center justify-center rounded bg-muted">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={current}>
          {current ?? 'None'}
        </span>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>Change</Button>
        {current && (
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Remove image" onClick={() => setImage(undefined)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {def.help && <p className="m-0 text-[10px] text-muted-foreground">{def.help}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Media library</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1 h-3.5 w-3.5" /> {busy ? 'Uploading…' : 'Upload image'}
              </Button>
              <input
                ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
              />
              <Input placeholder="Search recent…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 flex-1 text-sm" />
            </div>

            <div className="flex items-center gap-2">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="…or paste an image URL"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="h-8 flex-1 text-sm"
              />
              <Button size="sm" variant="outline" disabled={!isUrl(urlInput)} onClick={() => { pick({ url: urlInput, name: urlInput, uploadedAt: 0 }); setUrlInput(''); }}>
                Use
              </Button>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium">Recently uploaded</p>
              {recents.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing yet — upload an image or paste a URL.</p>
              ) : (
                <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto">
                  {recents.map((a) => (
                    <button
                      key={(a.fileStoreId ?? a.url) as string}
                      type="button"
                      onClick={() => pick(a)}
                      className="group overflow-hidden rounded-md border border-border hover:border-primary"
                      title={a.name}
                    >
                      {a.url ? (
                        <img src={a.url} alt={a.name} className="h-16 w-full object-cover" />
                      ) : (
                        <span className="flex h-16 items-center justify-center bg-muted"><ImageIcon className="h-4 w-4" /></span>
                      )}
                      <span className="block truncate px-1 py-0.5 text-[9px] text-muted-foreground">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="m-0 text-[10px] text-muted-foreground">
              Pasted URLs render on the published page today. Uploaded files preview in the Builder;
              published-page delivery for uploads arrives with the media phase (P2).
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
