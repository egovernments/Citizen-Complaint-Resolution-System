import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  BookOpen,
  FileText,
  HelpCircle,
  Lightbulb,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DocLink {
  title: string;
  url: string;
  description?: string;
}

interface DocSection {
  title: string;
  icon: React.ElementType;
  links: DocLink[];
}

// Documentation links organized by page/entity
const docsConfig: Record<string, DocSection[]> = {
  '/manage': [
    {
      title: 'Getting Started',
      icon: BookOpen,
      links: [
        {
          title: 'DIGIT Platform Overview',
          url: 'https://core.digit.org/platform/architecture/service-architecture',
          description: 'Understand the DIGIT architecture',
        },
        {
          title: 'Multi-Tenant Configuration',
          url: 'https://core.digit.org/platform/architecture/service-architecture',
          description: 'How tenants work in DIGIT',
        },
      ],
    },
    {
      title: 'Core Services',
      icon: FileText,
      links: [
        {
          title: 'MDMS Overview',
          url: 'https://core.digit.org/platform/core-services/mdms-v2-master-data-management-service',
          description: 'Master Data Management Service',
        },
        {
          title: 'Boundary Service',
          url: 'https://core.digit.org/platform/core-services/boundary-service',
          description: 'Manage administrative boundaries',
        },
      ],
    },
  ],
  '/manage/tenants': [
    {
      title: 'Tenant Configuration',
      icon: BookOpen,
      links: [
        {
          title: 'Configuring Tenants',
          url: 'https://core.digit.org/digit-core-1/platform/core-services/mdms-master-data-management-service/setting-up-master-data/configuring-tenants',
          description: 'How to configure ULBs and cities',
        },
        {
          title: 'What is a Tenant?',
          url: 'https://core.digit.org/platform/architecture/service-architecture',
          description: 'A tenant represents a body (State/ULB) in the system',
        },
      ],
    },
    {
      title: 'Related Docs',
      icon: FileText,
      links: [
        {
          title: 'MDMS Service',
          url: 'https://core.digit.org/platform/core-services/mdms-v2-master-data-management-service/mdms-master-data-management-service/setting-up-master-data/mdms-overview',
          description: 'Where tenant config is stored',
        },
      ],
    },
  ],
  '/manage/boundaries': [
    {
      title: 'Boundary Management',
      icon: BookOpen,
      links: [
        {
          title: 'Boundary Service',
          url: 'https://core.digit.org/platform/core-services/boundary-service',
          description: 'Create and manage boundary hierarchies',
        },
        {
          title: 'Location Services',
          url: 'https://core.digit.org/digit-core-1/platform/core-services/location-services',
          description: 'Legacy boundary management',
        },
        {
          title: 'Boundary API Specs',
          url: 'https://core.digit.org/platform/api-specifications/boundary',
          description: 'API reference for boundaries',
        },
      ],
    },
    {
      title: 'Guides',
      icon: Lightbulb,
      links: [
        {
          title: 'Migrate Boundary Data',
          url: 'https://docs.digit.org/platform/platform/core-services/boundary-service/migrate-old-boundary-data-steps',
          description: 'Migrate from legacy to new boundary service',
        },
      ],
    },
  ],
  '/manage/departments': [
    {
      title: 'Department Setup',
      icon: BookOpen,
      links: [
        {
          title: 'MDMS Master Data',
          url: 'https://core.digit.org/platform/core-services/mdms-v2-master-data-management-service/mdms-master-data-management-service/setting-up-master-data/mdms-overview',
          description: 'How master data is managed',
        },
        {
          title: 'PGR Department Mapping',
          url: 'https://docs.digit.org/local-governance/v2.7/products/modules/public-grievances-and-redressal/pgr-user-manual/complaint-types-list',
          description: 'How departments map to complaint types',
        },
      ],
    },
  ],
  '/manage/designations': [
    {
      title: 'Designation Setup',
      icon: BookOpen,
      links: [
        {
          title: 'HRMS Designation',
          url: 'https://docs.digit.org/works/reference-implementations/muktasoft-v2.2/deployment/configuration/master-data-templates/hrms-designation',
          description: 'Configure employee designations',
        },
        {
          title: 'Complaint Types & Designations',
          url: 'https://docs.digit.org/local-governance/v2.7/products/modules/public-grievances-and-redressal/pgr-user-manual/complaint-types-list',
          description: 'Map designations to complaint routing',
        },
      ],
    },
  ],
  '/manage/complaint-types': [
    {
      title: 'PGR Configuration',
      icon: BookOpen,
      links: [
        {
          title: 'Complaint Types List',
          url: 'https://docs.digit.org/local-governance/v2.7/products/modules/public-grievances-and-redressal/pgr-user-manual/complaint-types-list',
          description: 'All available complaint types',
        },
        {
          title: 'Grievance Sub Types',
          url: 'https://docs.digit.org/local-governance/local-governance-product-suite/local-governance-stack/public-grievances-and-redressal/pgr-master-data-templates/grievance-sub-type',
          description: 'Configure complaint subtypes and SLAs',
        },
        {
          title: 'PGR Service Config',
          url: 'https://docs.digit.org/health/setup/configuration/service-configuration/complaints',
          description: 'Service definitions and workflow',
        },
      ],
    },
    {
      title: 'User Guides',
      icon: HelpCircle,
      links: [
        {
          title: 'File Complaints (CSR)',
          url: 'https://docs.digit.org/local-governance/local-governance-product-suite/local-governance-stack/public-grievances-and-redressal/pgr-user-manual/employee-user-manual/csr-file-complaints',
          description: 'How CSR files complaints',
        },
        {
          title: 'Resolve Complaints (FME)',
          url: 'https://docs.digit.org/local-governance/local-governance-product-suite/local-governance-stack/public-grievances-and-redressal/pgr-user-manual/employee-user-manual/fme-resolve-complaints',
          description: 'How FME resolves complaints',
        },
      ],
    },
  ],
  '/manage/employees': [
    {
      title: 'Employee Management',
      icon: BookOpen,
      links: [
        {
          title: 'Employee Master',
          url: 'https://docs.digit.org/complaints-resolution/deploy/configure/master-data/master-data-templates/employee-master',
          description: 'Employee data structure and fields',
        },
        {
          title: 'HRMS Designation',
          url: 'https://docs.digit.org/works/reference-implementations/muktasoft-v2.2/deployment/configuration/master-data-templates/hrms-designation',
          description: 'Employee designations reference',
        },
      ],
    },
    {
      title: 'PGR Roles',
      icon: Lightbulb,
      links: [
        {
          title: 'Complaint Assignment',
          url: 'https://docs.digit.org/local-governance/local-governance-product-suite/local-governance-stack/public-grievances-and-redressal/pgr-user-manual/employee-user-manual/fme-request-reassign',
          description: 'How complaints are assigned to employees',
        },
      ],
    },
  ],
  '/manage/localization': [
    {
      title: 'Localization',
      icon: BookOpen,
      links: [
        {
          title: 'Localization Service',
          url: 'https://core.digit.org/platform/core-services/localization-service',
          description: 'Multi-language support for DIGIT',
        },
        {
          title: 'Adding Localization',
          url: 'https://core.digit.org/platform/core-services/localization-service/adding-new-language',
          description: 'How to add new languages',
        },
      ],
    },
  ],

  // ============================================
  // Advanced Entity Documentation
  // ============================================

  '/manage/advanced/state-info': [
    {
      title: 'State Configuration',
      icon: BookOpen,
      links: [
        {
          title: 'StateInfo Schema',
          url: 'https://core.digit.org/platform/core-services/mdms-v2-master-data-management-service/mdms-master-data-management-service/setting-up-master-data/common-masters',
          description: 'State-level configuration in common-masters',
        },
        {
          title: 'Multi-Tenant Architecture',
          url: 'https://core.digit.org/platform/architecture/service-architecture',
          description: 'How state and ULB hierarchy works',
        },
      ],
    },
  ],

  '/manage/advanced/branding': [
    {
      title: 'Branding Configuration',
      icon: BookOpen,
      links: [
        {
          title: 'Tenant Branding',
          url: 'https://core.digit.org/digit-core-1/platform/core-services/mdms-master-data-management-service/setting-up-master-data/configuring-tenants',
          description: 'Configure logos, colors, and branding',
        },
        {
          title: 'Filestore Service',
          url: 'https://core.digit.org/platform/core-services/filestore-service',
          description: 'Upload and manage logo images',
        },
      ],
    },
  ],

  '/manage/advanced/city-modules': [
    {
      title: 'City Modules',
      icon: BookOpen,
      links: [
        {
          title: 'Module Configuration',
          url: 'https://core.digit.org/digit-core-1/platform/core-services/mdms-master-data-management-service/setting-up-master-data/configuring-tenants',
          description: 'Enable/disable modules per city',
        },
        {
          title: 'Available Modules',
          url: 'https://docs.digit.org/local-governance/local-governance-product-suite',
          description: 'List of DIGIT modules',
        },
      ],
    },
  ],

  '/manage/advanced/id-formats': [
    {
      title: 'ID Generation',
      icon: BookOpen,
      links: [
        {
          title: 'ID Gen Service',
          url: 'https://core.digit.org/platform/core-services/id-generation-service',
          description: 'Automatic ID generation for entities',
        },
        {
          title: 'ID Format Configuration',
          url: 'https://core.digit.org/platform/core-services/id-generation-service/configuration-for-id-gen',
          description: 'Configure ID patterns and sequences',
        },
      ],
    },
    {
      title: 'Examples',
      icon: Lightbulb,
      links: [
        {
          title: 'Complaint ID Format',
          url: 'https://docs.digit.org/complaints-resolution/deploy/configure/configure-service/complaintnumber',
          description: 'How complaint numbers are generated',
        },
      ],
    },
  ],

  '/manage/advanced/workflow-services': [
    {
      title: 'Workflow Engine',
      icon: BookOpen,
      links: [
        {
          title: 'Workflow Service',
          url: 'https://core.digit.org/platform/core-services/workflow-service',
          description: 'State machine based workflow engine',
        },
        {
          title: 'Business Service API',
          url: 'https://core.digit.org/platform/core-services/workflow-service/workflow-service-overview',
          description: 'Define workflow states and transitions',
        },
      ],
    },
    {
      title: 'Examples',
      icon: Lightbulb,
      links: [
        {
          title: 'PGR Workflow',
          url: 'https://docs.digit.org/complaints-resolution/deploy/configure/configure-service/configure-workflow',
          description: 'Complaint resolution workflow example',
        },
      ],
    },
  ],

  '/manage/advanced/workflow-config': [
    {
      title: 'Workflow Configuration',
      icon: BookOpen,
      links: [
        {
          title: 'Configuring Workflows',
          url: 'https://core.digit.org/platform/core-services/workflow-service/configuring-workflows',
          description: 'Set up states, actions, and transitions',
        },
        {
          title: 'Business Service Config',
          url: 'https://core.digit.org/platform/core-services/workflow-service/workflow-service-overview',
          description: 'Configure workflow behavior',
        },
      ],
    },
  ],

  '/manage/advanced/auto-escalation': [
    {
      title: 'Auto Escalation',
      icon: BookOpen,
      links: [
        {
          title: 'Escalation Configuration',
          url: 'https://core.digit.org/platform/core-services/workflow-service',
          description: 'Automatic escalation on SLA breach',
        },
        {
          title: 'SLA Management',
          url: 'https://docs.digit.org/complaints-resolution/deploy/configure/configure-service/configure-workflow',
          description: 'Configure SLA times for workflows',
        },
      ],
    },
  ],

  '/manage/advanced/sla-config': [
    {
      title: 'SLA Configuration',
      icon: BookOpen,
      links: [
        {
          title: 'Workflow SLA',
          url: 'https://core.digit.org/platform/core-services/workflow-service',
          description: 'Service Level Agreement configuration',
        },
        {
          title: 'PGR SLA Setup',
          url: 'https://docs.digit.org/local-governance/local-governance-product-suite/local-governance-stack/public-grievances-and-redressal/pgr-master-data-templates/grievance-sub-type',
          description: 'Configure SLA hours per complaint type',
        },
      ],
    },
  ],

  '/manage/advanced/role-actions': [
    {
      title: 'Access Control',
      icon: BookOpen,
      links: [
        {
          title: 'Access Control Service',
          url: 'https://core.digit.org/platform/core-services/access-control-services',
          description: 'Role-based access control in DIGIT',
        },
        {
          title: 'Role-Action Mapping',
          url: 'https://core.digit.org/platform/core-services/access-control-services/role-action-mapping',
          description: 'Map roles to allowed actions',
        },
      ],
    },
    {
      title: 'Configuration',
      icon: FileText,
      links: [
        {
          title: 'Adding Role Actions',
          url: 'https://core.digit.org/platform/core-services/access-control-services/adding-new-role-action-mapping',
          description: 'How to add new permissions',
        },
      ],
    },
  ],

  '/manage/advanced/action-mappings': [
    {
      title: 'Action Configuration',
      icon: BookOpen,
      links: [
        {
          title: 'Actions Test Config',
          url: 'https://core.digit.org/platform/core-services/access-control-services',
          description: 'API endpoint action definitions',
        },
        {
          title: 'Action Mapping Guide',
          url: 'https://core.digit.org/platform/core-services/access-control-services/role-action-mapping',
          description: 'How actions are mapped to APIs',
        },
      ],
    },
  ],

  '/manage/advanced/encryption-policy': [
    {
      title: 'Data Security',
      icon: BookOpen,
      links: [
        {
          title: 'Encryption Service',
          url: 'https://core.digit.org/platform/core-services/encryption-service',
          description: 'Field-level encryption in DIGIT',
        },
        {
          title: 'Security Best Practices',
          url: 'https://core.digit.org/platform/architecture/security-architecture',
          description: 'DIGIT security architecture',
        },
      ],
    },
  ],

  '/manage/advanced/decryption-abac': [
    {
      title: 'Decryption Control',
      icon: BookOpen,
      links: [
        {
          title: 'ABAC Overview',
          url: 'https://core.digit.org/platform/core-services/encryption-service',
          description: 'Attribute-based access control for decryption',
        },
        {
          title: 'Security Policies',
          url: 'https://core.digit.org/platform/architecture/security-architecture',
          description: 'Configure who can decrypt data',
        },
      ],
    },
  ],

  '/manage/advanced/masking-patterns': [
    {
      title: 'Data Masking',
      icon: BookOpen,
      links: [
        {
          title: 'Encryption Service',
          url: 'https://core.digit.org/platform/core-services/encryption-service',
          description: 'Mask sensitive data in responses',
        },
        {
          title: 'PII Protection',
          url: 'https://core.digit.org/platform/architecture/security-architecture',
          description: 'Protect personally identifiable information',
        },
      ],
    },
  ],

  '/manage/advanced/security-policy': [
    {
      title: 'Security Policies',
      icon: BookOpen,
      links: [
        {
          title: 'Security Architecture',
          url: 'https://core.digit.org/platform/architecture/security-architecture',
          description: 'Overall security approach in DIGIT',
        },
        {
          title: 'Data Protection',
          url: 'https://core.digit.org/platform/core-services/encryption-service',
          description: 'How sensitive data is protected',
        },
      ],
    },
  ],

  '/manage/advanced/inbox-config': [
    {
      title: 'Inbox Service',
      icon: BookOpen,
      links: [
        {
          title: 'Inbox Service Overview',
          url: 'https://core.digit.org/platform/core-services/inbox-service',
          description: 'Unified inbox for all modules',
        },
        {
          title: 'Query Configuration',
          url: 'https://core.digit.org/platform/core-services/inbox-service',
          description: 'Configure inbox search queries',
        },
      ],
    },
  ],

  '/manage/advanced/deactivation-reasons': [
    {
      title: 'HRMS Configuration',
      icon: BookOpen,
      links: [
        {
          title: 'HRMS Overview',
          url: 'https://docs.digit.org/complaints-resolution/deploy/configure/master-data/master-data-templates/employee-master',
          description: 'Human Resource Management System',
        },
        {
          title: 'Employee Lifecycle',
          url: 'https://docs.digit.org/works/reference-implementations/muktasoft-v2.2/deployment/configuration/master-data-templates/hrms-designation',
          description: 'Employee status management',
        },
      ],
    },
  ],

  '/manage/advanced/degrees': [
    {
      title: 'Educational Qualifications',
      icon: BookOpen,
      links: [
        {
          title: 'Employee Master',
          url: 'https://docs.digit.org/complaints-resolution/deploy/configure/master-data/master-data-templates/employee-master',
          description: 'Employee qualification fields',
        },
        {
          title: 'HRMS Configuration',
          url: 'https://docs.digit.org/works/reference-implementations/muktasoft-v2.2/deployment/configuration/master-data-templates/hrms-designation',
          description: 'Configure HR master data',
        },
      ],
    },
  ],

  '/manage/advanced/employment-tests': [
    {
      title: 'Employment Tests',
      icon: BookOpen,
      links: [
        {
          title: 'HRMS Master Data',
          url: 'https://docs.digit.org/complaints-resolution/deploy/configure/master-data/master-data-templates/employee-master',
          description: 'Configure employment test types',
        },
      ],
    },
  ],

  '/manage/advanced/specializations': [
    {
      title: 'Specializations',
      icon: BookOpen,
      links: [
        {
          title: 'Employee Qualifications',
          url: 'https://docs.digit.org/complaints-resolution/deploy/configure/master-data/master-data-templates/employee-master',
          description: 'Configure specialization areas',
        },
      ],
    },
  ],

  '/manage/advanced/cron-jobs': [
    {
      title: 'Scheduled Jobs',
      icon: BookOpen,
      links: [
        {
          title: 'Scheduler Service',
          url: 'https://core.digit.org/platform/core-services',
          description: 'Configure scheduled API calls',
        },
        {
          title: 'Background Tasks',
          url: 'https://core.digit.org/platform/architecture/service-architecture',
          description: 'Async processing in DIGIT',
        },
      ],
    },
  ],

  '/manage/advanced/ui-homepage': [
    {
      title: 'UI Configuration',
      icon: BookOpen,
      links: [
        {
          title: 'UI Customization',
          url: 'https://core.digit.org/platform/ui-developer-guide',
          description: 'Customize the DIGIT UI',
        },
        {
          title: 'Homepage Modules',
          url: 'https://docs.digit.org/local-governance/local-governance-product-suite',
          description: 'Configure homepage module cards',
        },
      ],
    },
  ],
};

// Default docs for pages without specific config
const defaultDocs: DocSection[] = [
  {
    title: 'DIGIT Documentation',
    icon: BookOpen,
    links: [
      {
        title: 'Core Platform Docs',
        url: 'https://core.digit.org',
        description: 'DIGIT Core documentation',
      },
      {
        title: 'Product Docs',
        url: 'https://docs.digit.org',
        description: 'DIGIT product documentation',
      },
    ],
  },
];

export default function DocsPane() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  // Find matching docs for current path
  const currentPath = location.pathname;
  const docs = docsConfig[currentPath] || defaultDocs;

  return (
    <aside
      className={`${
        collapsed ? 'w-12' : 'w-64'
      } bg-card border-l border-border flex flex-col transition-all duration-200`}
    >
      {/* Header */}
      <div className="h-16 border-b border-border flex items-center px-3 gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </Button>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm text-foreground">Documentation</span>
          </div>
        )}
      </div>

      {/* Content */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {docs.map((section, sectionIdx) => {
            const Icon = section.icon;
            return (
              <div key={sectionIdx} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <Icon className="w-3.5 h-3.5" />
                  {section.title}
                </div>
                <div className="space-y-1">
                  {section.links.map((link, linkIdx) => (
                    <a
                      key={linkIdx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-2 rounded-md hover:bg-muted transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground group-hover:text-primary truncate">
                            {link.title}
                          </p>
                          {link.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {link.description}
                            </p>
                          )}
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary flex-shrink-0 mt-0.5" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Collapsed state - just show icon */}
      {collapsed && (
        <div className="flex-1 flex flex-col items-center py-4">
          <BookOpen className="w-5 h-5 text-muted-foreground" />
        </div>
      )}

      {/* Footer */}
      {!collapsed && (
        <div className="border-t border-border p-3">
          <a
            href="https://core.digit.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open DIGIT Docs
          </a>
        </div>
      )}
    </aside>
  );
}
