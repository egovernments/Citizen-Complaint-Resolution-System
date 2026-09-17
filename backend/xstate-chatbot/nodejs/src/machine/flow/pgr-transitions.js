// The shape of the grievance journey, and nothing else. Read top to bottom to
// see the whole conversation; open pgr-states.js to see what any one step asks.

module.exports = {
  // where each group begins
  entry: {
    pgr: 'menu',
    fileComplaint: 'type',
    'fileComplaint.type': 'complaintType2Step',
    'fileComplaint.location': 'boundary',
    'fileComplaint.other': 'institution'
  },

  // where each step goes
  exits: {
    menu:               { fileComplaint: 'fileComplaint', trackComplaint: 'trackComplaint' },
    complaintType2Step: { onLeaf: 'other' },
    institution:        'description',
    description:        'imageUpload',
    imageUpload:        'location',
    boundary:           { onLeaf: 'consent', onEmpty: 'consent' },
    consent:            { Yes: 'confidentiality', No: 'consentDeclined' },
    consentDeclined:    'endstate',
    confidentiality:    { Yes: 'persistComplaint', No: 'persistComplaint' },
    persistComplaint:   { filed: 'endstate' },
    trackComplaint:     { hasRecords: 'endstate', noRecords: 'endstate' }
  }
};
