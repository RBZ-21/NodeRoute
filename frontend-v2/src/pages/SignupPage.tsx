import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { clearSession } from '../lib/api';

type DistributorType = 'seafood' | 'liquor' | 'wine' | 'beer' | 'food' | '';
type InventoryChoice = 'template' | 'import' | 'blank' | '';

type SignupState = {
  email: string;
  firstName: string;
  lastName: string;
  businessName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  distributorType: DistributorType;
  inventoryChoice: InventoryChoice;
  selectedTemplate: string;
  password: string;
  confirmPassword: string;
};

const DISTRIBUTOR_OPTIONS: {
  value: Exclude<DistributorType, ''>;
  label: string;
  description: string;
}[] = [
  { value: 'seafood', label: 'Seafood', description: 'Fresh, frozen, and catch-weight inventory workflows.' },
  { value: 'liquor', label: 'Liquor', description: 'Spirits distribution with compliance-friendly defaults.' },
  { value: 'wine', label: 'Wine', description: 'Wine-focused operations with bottle and case-friendly setup.' },
  { value: 'beer', label: 'Beer and Beverage', description: 'Kegs, cases, deposits, and beverage routing.' },
  { value: 'food', label: 'Broadline Food', description: 'Mixed catalog operations similar to broadline distributors.' },
];

const TEMPLATE_MAP: Record<DistributorType, { label: string; value: string }[]> = {
  seafood: [{ label: 'Standard Seafood Template', value: 'seafood' }],
  liquor: [{ label: 'Standard Liquor Template', value: 'liquor' }],
  wine: [{ label: 'Standard Wine Template', value: 'liquor' }],
  beer: [{ label: 'Standard Beer Template', value: 'liquor' }],
  food: [{ label: 'Broadline Food Template', value: 'broadline' }],
  '': [],
};

const INITIAL_STATE: SignupState = {
  email: '',
  firstName: '',
  lastName: '',
  businessName: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  distributorType: '',
  inventoryChoice: '',
  selectedTemplate: '',
  password: '',
  confirmPassword: '',
};

type SignupResponse = {
  user: {
    role?: string;
  };
};

export function SignupPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<SignupState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const rawUser = localStorage.getItem('nr_user');
    if (!rawUser) return;
    window.location.href = '/dashboard';
  }, []);

  const setField = (field: keyof SignupState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const canAdvanceStep1 = useMemo(
    () =>
      form.email.includes('@') &&
      form.password.length >= 8 &&
      form.password === form.confirmPassword,
    [form.confirmPassword, form.email, form.password]
  );
  const canAdvanceStep2 = useMemo(
    () =>
      Boolean(form.firstName && form.lastName && form.businessName && form.city && form.state),
    [form.businessName, form.city, form.firstName, form.lastName, form.state]
  );
  const canAdvanceStep3 = form.distributorType !== '';
  const canAdvanceStep4 =
    form.inventoryChoice !== '' &&
    (form.inventoryChoice !== 'template' || form.selectedTemplate !== '');

  async function submitSignup() {
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/auth/signup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          confirmPassword: form.confirmPassword,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          businessName: form.businessName.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          city: form.city.trim(),
          state: form.state.trim().toUpperCase(),
          zip: form.zip.trim(),
          distributorType: form.distributorType,
          inventoryChoice: form.inventoryChoice,
          selectedTemplate: form.selectedTemplate,
        }),
      });

      const payload = (await response.json()) as Partial<SignupResponse> & { error?: string };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error || 'Signup failed');
      }

      localStorage.setItem('nr_user', JSON.stringify(payload.user));
      window.location.href = '/dashboard';
    } catch (signupError) {
      clearSession();
      setError(String((signupError as Error).message || 'Signup failed'));
    } finally {
      setSubmitting(false);
    }
  }

  const steps = ['Account', 'Business', 'Type', 'Inventory'];
  const templateOptions = form.distributorType ? TEMPLATE_MAP[form.distributorType] : [];

  return (
    <div className="min-h-screen bg-enterprise-gradient">
      <div className="mx-auto flex min-h-screen max-w-[1420px] items-center justify-center p-4 md:p-6">
        <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.1fr_560px]">
          <Card className="hidden border-border/80 bg-card/95 shadow-panel lg:block">
            <CardHeader className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <Building2 className="h-4 w-4" />
                NodeRoute Signup
              </div>
              <CardTitle className="max-w-xl text-4xl leading-tight">
                Launch your distributor workspace with routes, inventory, customers, and invoicing in one place.
              </CardTitle>
              <CardDescription className="max-w-lg text-base">
                This setup creates your company account and tees up the right defaults for your vertical so your team can get moving quickly.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="text-sm font-semibold text-foreground">Company-first setup</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Create the business workspace and the first admin account in one pass.
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="text-sm font-semibold text-foreground">Industry defaults</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Choose your distributor type and we preload the right catalog and feature direction.
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/95 shadow-panel">
            <CardHeader className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <ShieldCheck className="h-4 w-4" />
                Create Account
              </div>
              <CardTitle>Start your NodeRoute workspace</CardTitle>
              <CardDescription>
                Step {step} of {steps.length}. You can refine the setup inside the app after signup.
              </CardDescription>
              <div className="flex items-center gap-2 pt-2">
                {steps.map((label, index) => {
                  const stepNumber = index + 1;
                  const active = step === stepNumber;
                  const complete = step > stepNumber;
                  return (
                    <div key={label} className="flex flex-1 items-center gap-2">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${
                          complete
                            ? 'border-primary bg-primary text-primary-foreground'
                            : active
                              ? 'border-primary text-primary'
                              : 'border-border text-muted-foreground'
                        }`}
                      >
                        {complete ? <Check className="h-4 w-4" /> : stepNumber}
                      </div>
                      <div className="hidden text-xs font-medium text-muted-foreground sm:block">{label}</div>
                    </div>
                  );
                })}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {error ? (
                <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              {step === 1 ? (
                <div className="space-y-4">
                  <div className="space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(event) => setField('email', event.target.value)}
                      placeholder="you@yourbusiness.com"
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password</span>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(event) => setField('password', event.target.value)}
                      placeholder="Minimum 8 characters"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Confirm Password</span>
                    <Input
                      type="password"
                      value={form.confirmPassword}
                      onChange={(event) => setField('confirmPassword', event.target.value)}
                      placeholder="Re-enter password"
                      autoComplete="new-password"
                    />
                    {form.confirmPassword && form.password !== form.confirmPassword ? (
                      <p className="text-xs text-destructive">Passwords must match.</p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {step === 2 ? (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">First Name</span>
                      <Input value={form.firstName} onChange={(event) => setField('firstName', event.target.value)} placeholder="John" />
                    </div>
                    <div className="space-y-1 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last Name</span>
                      <Input value={form.lastName} onChange={(event) => setField('lastName', event.target.value)} placeholder="Smith" />
                    </div>
                  </div>
                  <div className="space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business Name</span>
                    <Input value={form.businessName} onChange={(event) => setField('businessName', event.target.value)} placeholder="Coastal Seafood Distributors LLC" />
                  </div>
                  <div className="space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phone</span>
                    <Input value={form.phone} onChange={(event) => setField('phone', event.target.value)} placeholder="(843) 555-0100" />
                  </div>
                  <div className="space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Street Address</span>
                    <Input value={form.address} onChange={(event) => setField('address', event.target.value)} placeholder="123 Harbor Drive" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[1.5fr_100px_120px]">
                    <div className="space-y-1 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">City</span>
                      <Input value={form.city} onChange={(event) => setField('city', event.target.value)} placeholder="Charleston" />
                    </div>
                    <div className="space-y-1 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">State</span>
                      <Input
                        value={form.state}
                        onChange={(event) => setField('state', event.target.value.toUpperCase().slice(0, 2))}
                        placeholder="SC"
                        maxLength={2}
                      />
                    </div>
                    <div className="space-y-1 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ZIP</span>
                      <Input
                        value={form.zip}
                        onChange={(event) => setField('zip', event.target.value.slice(0, 10))}
                        placeholder="29401"
                        maxLength={10}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {step === 3 ? (
                <div className="space-y-3">
                  {DISTRIBUTOR_OPTIONS.map((option) => {
                    const selected = form.distributorType === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setField('distributorType', option.value);
                          setField('inventoryChoice', '');
                          setField('selectedTemplate', '');
                        }}
                        className={`w-full rounded-lg border-2 px-4 py-4 text-left transition-colors ${
                          selected
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-card hover:border-primary/50 hover:bg-muted/40'
                        }`}
                      >
                        <div className="font-medium">{option.label}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{option.description}</div>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {step === 4 ? (
                <div className="space-y-4">
                  <div className="grid gap-3">
                    {(
                      [
                        {
                          value: 'template',
                          label: 'Use a pre-made template',
                          description: 'Start with a vertical-specific sample catalog you can edit later.',
                        },
                        {
                          value: 'import',
                          label: 'Import my inventory',
                          description: 'Upload your CSV after signup and map your own catalog.',
                        },
                        {
                          value: 'blank',
                          label: 'Start blank',
                          description: 'Begin with an empty workspace and add items manually.',
                        },
                      ] as const
                    ).map((option) => {
                      const selected = form.inventoryChoice === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setField('inventoryChoice', option.value);
                            setField('selectedTemplate', option.value === 'template' ? templateOptions[0]?.value || '' : '');
                          }}
                          className={`w-full rounded-lg border-2 px-4 py-4 text-left transition-colors ${
                            selected
                              ? 'border-primary bg-primary/10'
                              : 'border-border bg-card hover:border-primary/50 hover:bg-muted/40'
                          }`}
                        >
                          <div className="font-medium">{option.label}</div>
                          <div className="mt-1 text-sm text-muted-foreground">{option.description}</div>
                        </button>
                      );
                    })}
                  </div>

                  {form.inventoryChoice === 'template' && templateOptions.length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Template</div>
                      {templateOptions.map((template) => {
                        const selected = form.selectedTemplate === template.value;
                        return (
                          <button
                            key={template.value}
                            type="button"
                            onClick={() => setField('selectedTemplate', template.value)}
                            className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              selected
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border bg-card hover:border-primary/50'
                            }`}
                          >
                            {template.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={step === 1 || submitting}
                  onClick={() => {
                    setError('');
                    setStep((current) => current - 1);
                  }}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>

                {step < steps.length ? (
                  <Button
                    type="button"
                    disabled={
                      submitting ||
                      (step === 1 && !canAdvanceStep1) ||
                      (step === 2 && !canAdvanceStep2) ||
                      (step === 3 && !canAdvanceStep3)
                    }
                    onClick={() => {
                      setError('');
                      setStep((current) => current + 1);
                    }}
                  >
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="button" disabled={!canAdvanceStep4 || submitting} onClick={submitSignup}>
                    {submitting ? 'Creating account...' : 'Launch my account'}
                  </Button>
                )}
              </div>

              <div className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <a href="/login" className="font-medium text-primary hover:underline">
                  Sign in
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
