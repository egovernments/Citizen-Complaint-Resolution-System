/**
 * Citizen profile — read + edit name/email/gender/dob/photo. Mobile is
 * shown read-only because /user/profile/_update silently drops mobile
 * changes (see useCitizenProfile.ts for the full list of API traps).
 *
 * Photo upload is two-step: file picker → POST /filestore/v1/files
 * returns a fileStoreId, which is then written to the form and only
 * persisted on Save. If the user cancels before saving, the orphaned
 * upload just sits in filestore — DIGIT doesn't garbage-collect those,
 * so we keep the surface small and don't generate one until the citizen
 * actively picks a file.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import {
  useCitizenProfile,
  uploadProfilePhoto,
  fetchPhotoUrl,
  GENDERS,
  type Gender,
  type ProfilePatch,
  type CitizenProfile,
} from '@/hooks/useCitizenProfile';
import { useApp } from '@/App';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Camera, Loader2, LogOut, UserCircle } from 'lucide-react';

type FormShape = {
  name: string;
  emailId: string;
  gender: Gender | '';
  dob: string;
  photo: string;
};

function toFormDefaults(p: CitizenProfile): FormShape {
  return {
    name: p.name ?? '',
    emailId: p.emailId ?? '',
    gender: p.gender ?? '',
    dob: p.dob ?? '',
    photo: p.photo ?? '',
  };
}

function ProfilePhoto({ photoId }: { photoId: string }) {
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    setUrl('');
    if (!photoId) return;
    let cancelled = false;
    fetchPhotoUrl(photoId).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  return (
    <div className="h-24 w-24 rounded-full bg-muted overflow-hidden flex items-center justify-center text-muted-foreground border">
      {url ? (
        <img src={url} alt="Profile" className="h-full w-full object-cover" />
      ) : (
        <UserCircle className="h-16 w-16" />
      )}
    </div>
  );
}

export default function CitizenProfilePage() {
  const { profile, isLoading, error, save, isSaving, saveError } = useCitizenProfile();
  const { logout } = useApp();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setUploading] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const form = useForm<FormShape>({
    defaultValues: profile ? toFormDefaults(profile) : undefined,
  });

  // Reset form when the underlying profile changes (initial load + refetch).
  useEffect(() => {
    if (profile) form.reset(toFormDefaults(profile));
  }, [profile, form]);

  if (isLoading || !profile) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading profile…
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error instanceof Error ? error.message : 'Failed to load profile.'}
        </AlertDescription>
      </Alert>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const patch: ProfilePatch = {
      name: values.name,
      emailId: values.emailId || null,
      gender: values.gender || null,
      dob: values.dob || null,
      photo: values.photo || null,
    };
    await save(patch);
    setSavedAt(Date.now());
  });

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const id = await uploadProfilePhoto(file);
      form.setValue('photo', id, { shouldDirty: true });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Photo upload failed.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const currentPhoto = form.watch('photo');
  const isDirty = form.formState.isDirty;

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Manage how your name and contact details appear to the city team.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <ProfilePhoto photoId={currentPhoto} />
              <div className="space-y-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickPhoto}
                  data-testid="profile-photo-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4 mr-2" />
                  )}
                  {isUploading ? 'Uploading…' : 'Change photo'}
                </Button>
                {uploadError && (
                  <p className="text-xs text-destructive">{uploadError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  JPG or PNG. Saved when you press Save changes.
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-1">
              <Label htmlFor="profile-mobile">Mobile number</Label>
              <Input id="profile-mobile" value={profile.mobileNumber} disabled />
              <p className="text-xs text-muted-foreground">
                Mobile cannot be changed here. To use a different number, sign
                out and register again with the new mobile.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="profile-name">Full name</Label>
              <Input
                id="profile-name"
                {...form.register('name', { required: 'Name is required.' })}
              />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="profile-email">Email (optional)</Label>
              <Input
                id="profile-email"
                type="email"
                placeholder="you@example.com"
                {...form.register('emailId', {
                  validate: (v) =>
                    !v || /.+@.+\..+/.test(v) || 'Enter a valid email address.',
                })}
              />
              {form.formState.errors.emailId && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.emailId.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Gender</Label>
              <Controller
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <div className="flex gap-3">
                    {GENDERS.map(({ value, label }) => {
                      const checked = field.value === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => field.onChange(value)}
                          className={
                            'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                            (checked
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-input hover:bg-muted text-foreground/70')
                          }
                          aria-pressed={checked}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="profile-dob">Date of birth (optional)</Label>
              <Input id="profile-dob" type="date" {...form.register('dob')} />
            </div>

            {saveError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {saveError instanceof Error
                    ? saveError.message
                    : 'Saving the profile failed.'}
                </AlertDescription>
              </Alert>
            )}

            {savedAt && !isDirty && (
              <Alert>
                <AlertDescription>Profile saved.</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button type="submit" disabled={!isDirty || isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save changes
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!isDirty || isSaving}
                onClick={() => {
                  form.reset(toFormDefaults(profile));
                  setSavedAt(null);
                }}
              >
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign out of Nai Pepea?</AlertDialogTitle>
                <AlertDialogDescription>
                  You'll be returned to the login screen. Your complaints stay
                  open — just sign back in with the same mobile to track them.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    logout();
                    navigate('/login', { replace: true });
                  }}
                >
                  Sign out
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
