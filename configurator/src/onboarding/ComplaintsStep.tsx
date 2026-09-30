import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useApp } from '../App';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DigitCard } from '@/components/digit/DigitCard';
import { Banner } from '@/components/digit/Banner';
import { ComplaintHierarchySetup } from '@/components/ComplaintHierarchySetup';
import { ONBOARDING_STEPS } from './steps';

const STEP = ONBOARDING_STEPS.find((step) => step.id === 'complaints')!;

/**
 * The last step: complaint types built from scratch. Finishing it finishes
 * onboarding, and the account moves on to management for good.
 */
export default function ComplaintsStep() {
  const { state, completePhase, setMode } = useApp();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const targetTenant = state.targetTenant || state.tenant;

  const finish = () => {
    completePhase(STEP.number);
    setMode('management');
    navigate('/manage');
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.5px] text-muted-foreground">Complaints</p>
        <h2 className="mt-1 text-2xl sm:text-3xl font-bold font-condensed text-foreground">{STEP.label}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Start from scratch: set up the kinds of complaints people can raise, which department each one goes to and
          how long it should take to resolve.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {created === null ? (
        <DigitCard>
          <ComplaintHierarchySetup
            targetTenant={targetTenant}
            stateTenant={state.tenant}
            onError={setError}
            onDone={({ defs }) => {
              setError(null);
              setCreated(defs);
            }}
          />
        </DigitCard>
      ) : (
        <DigitCard>
          <Banner successful message="Complaint types are ready" info={`${created} complaint types set up for ${targetTenant.toUpperCase()}`} />
          <div className="mt-6 flex justify-end">
            <Button onClick={finish} className="gap-2">
              Finish setup
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </DigitCard>
      )}
    </div>
  );
}
