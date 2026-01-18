import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { Eye, EyeOff, Loader2, Database, AlertCircle, HelpCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DigitCard, DigitCardHeader, DigitCardSubHeader } from '@/components/digit/DigitCard';
import { LabelFieldPair, CardLabel, Field } from '@/components/digit/LabelFieldPair';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { apiClient, ENVIRONMENTS, ApiClientError } from '@/api';

export default function LoginPage() {
  const { login } = useApp();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    environment: ENVIRONMENTS[0].url,
    username: '',
    password: '',
    tenantCode: 'pg',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Set environment first
      apiClient.setEnvironment(formData.environment);

      // Attempt real login
      const response = await apiClient.login({
        username: formData.username,
        password: formData.password,
        tenantId: formData.tenantCode,
        userType: 'EMPLOYEE',
      });

      // Extract roles from response
      const roles = response.UserRequest.roles?.map(r => r.code) || [];

      // Check for required roles
      const hasRequiredRole = roles.some(r =>
        ['MDMS_ADMIN', 'SUPERUSER', 'LOC_ADMIN', 'EMPLOYEE'].includes(r)
      );

      if (!hasRequiredRole) {
        setError('User does not have required roles (MDMS_ADMIN, SUPERUSER, or LOC_ADMIN)');
        setLoading(false);
        return;
      }

      // Update app state
      login(
        {
          name: response.UserRequest.name,
          email: response.UserRequest.emailId || `${response.UserRequest.userName}@digit.org`,
          roles: roles,
        },
        formData.environment,
        formData.tenantCode
      );

      navigate('/phase/1');
    } catch (err) {
      console.error('Login error:', err);

      if (err instanceof ApiClientError) {
        setError(err.firstError);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed. Please check your credentials.');
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo - DIGIT style */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <div className="w-1 h-12 bg-primary mr-3" />
            <Database className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-2xl font-condensed font-bold text-foreground">CRS Data Loader</h1>
          <p className="text-muted-foreground mt-1">Configure your DIGIT environment</p>
        </div>

        {/* Login form - DIGIT Card */}
        <DigitCard>
          <DigitCardHeader>Sign In</DigitCardHeader>
          <DigitCardSubHeader>Enter your credentials to continue</DigitCardSubHeader>

          <form onSubmit={handleSubmit} className="space-y-6 mt-6">
            {/* Error message */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  {error}
                </AlertDescription>
              </Alert>
            )}

            {/* Environment */}
            <LabelFieldPair>
              <CardLabel required>Environment</CardLabel>
              <Field>
                <Select
                  value={formData.environment}
                  onValueChange={(value) => setFormData({ ...formData, environment: value })}
                >
                  <SelectTrigger id="environment" className="border-input-border focus:border-primary focus:ring-primary">
                    <SelectValue placeholder="Select environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENVIRONMENTS.map((env) => (
                      <SelectItem key={env.url} value={env.url}>
                        {env.name} ({env.url.replace('https://', '')})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </LabelFieldPair>

            {/* Username */}
            <LabelFieldPair>
              <CardLabel required>Username</CardLabel>
              <Field>
                <Input
                  id="username"
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="Enter username"
                  className="border-input-border focus:border-primary focus:ring-primary"
                  required
                />
              </Field>
            </LabelFieldPair>

            {/* Password */}
            <LabelFieldPair>
              <CardLabel required>Password</CardLabel>
              <Field>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="pr-10 border-input-border focus:border-primary focus:ring-primary"
                    placeholder="Enter password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
            </LabelFieldPair>

            {/* Tenant Code */}
            <LabelFieldPair>
              <CardLabel className="flex items-center gap-1" required>
                Tenant Code
                <button
                  type="button"
                  className="text-muted-foreground hover:text-primary"
                  title="Root tenant for authentication (e.g., 'pg' for Punjab)"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </CardLabel>
              <Field>
                <Input
                  id="tenantCode"
                  type="text"
                  value={formData.tenantCode}
                  onChange={(e) => setFormData({ ...formData, tenantCode: e.target.value })}
                  placeholder="pg"
                  className="border-input-border focus:border-primary focus:ring-primary"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">Root tenant for authentication</p>
              </Field>
            </LabelFieldPair>

            {/* Submit button - DIGIT SubmitBar */}
            <div className="flex justify-center pt-4">
              <SubmitBar
                label={loading ? 'Signing In...' : 'Sign In'}
                onSubmit={() => {}}
                disabled={loading}
                type="submit"
                icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
              />
            </div>
          </form>
        </DigitCard>

        {/* Help text */}
        <p className="text-center text-sm text-muted-foreground mt-6">
          Requires MDMS_ADMIN or SUPERUSER role
        </p>
      </div>
    </div>
  );
}
