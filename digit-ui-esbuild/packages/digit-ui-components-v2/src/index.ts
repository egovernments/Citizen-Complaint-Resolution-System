// Public surface of @egovernments/digit-ui-components-v2.
// All exports are tree-shakeable; consumers import named symbols only.

// Primitives
export { Button, buttonVariants, type ButtonProps } from "./components/ui/button";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/ui/card";
export { Input, type InputProps } from "./components/ui/input";
export { Textarea, type TextareaProps } from "./components/ui/textarea";
export { Label, type LabelProps } from "./components/ui/label";
export { Field, type FieldProps } from "./components/ui/field";
export {
  RadioCards,
  type RadioCardOption,
  type RadioCardsProps,
} from "./components/ui/radio-cards";
export { Select, type SelectOption, type SelectProps } from "./components/ui/select";
export {
  FileUpload,
  type FileUploadProps,
  type UploadedFile,
} from "./components/ui/file-upload";

// Layout / chrome
export {
  ScreenContainer,
  ScreenHeader,
  FormFooter,
  BackLink,
  type BackLinkProps,
  type ScreenContainerProps,
  type ScreenHeaderProps,
  type FormFooterProps,
} from "./components/layout/screen";
export { Stepper, type StepperProps, type StepperStep } from "./components/layout/stepper";
export {
  CitizenSidebar,
  type CitizenSidebarProps,
} from "./components/layout/citizen-sidebar";
export {
  CitizenServices,
  type CitizenServiceModule,
  type CitizenServicesProps,
} from "./components/citizen-services";

// Forms
export {
  useMultiStepForm,
  type MultiStepFormState,
  type UseMultiStepFormOptions,
} from "./components/forms/multi-step-form";

// Utilities
export { cn } from "./lib/cn";
