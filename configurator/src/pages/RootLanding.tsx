import { Navigate } from 'react-router-dom';

/**
 * The public root has one identity entry point.
 *
 * LoginPage owns session discovery and tenant selection. Signup callbacks now
 * carry an explicit `/signup` return destination, while sign-in callbacks carry
 * `/login`; the deployment fallback can therefore safely come here and enter
 * the normal sign-in journey without a second session-routing implementation.
 */
export default function RootLanding() {
  return <Navigate to="/login" replace />;
}
