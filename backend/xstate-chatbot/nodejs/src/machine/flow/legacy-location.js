// Unreachable since the boundary walk replaced the geo/fuzzy-search location
// flow. Kept verbatim (dedented only) so the behaviour can be revived; nothing
// in the live flow targets these states. See src/machine/flow/pgr-states.js.
const { assign } = require('xstate');
const dialog = require('../util/dialog');

module.exports = ({ messages, grammer, pgrService, config }) => ({

geoLocationSharingInfo: {
  id: 'geoLocationSharingInfo',
  onEntry: assign( (context, event) => {
    var message;
    if (config.isSandboxMode) {
      // In sandbox mode, use direct URL for location instructions
      message = {
        type: 'image',
        output: config.pgrUseCase.locationInstructionsUrl
      };
    } else {
      // In production, use filestore ID
      message = {
        type: 'image',
        output: config.pgrUseCase.informationImageFilestoreId
      };
    }
    dialog.sendMessage(context, message);
  }),
  always: 'geoLocation'
},
geoLocation: {
  id: 'geoLocation',
  initial: 'question',
  states : {
    question: {
      onEntry: assign( (context, event) => {
        let message = dialog.get_message(messages.fileComplaint.geoLocation.question, context.user.locale)
        dialog.sendMessage(context, message);
      }),
      on: {
        USER_MESSAGE: 'process'
      }
    },
    process: {
      invoke: {
        id: 'getCityAndLocality',
        src: (context, event) => {
          // Add null checks for event and event.message
          if(event && event.message && event.message.type === 'location') {
            context.slots.pgr.geocode = event.message.input;
            return pgrService.getCityAndLocalityForGeocode(event.message.input, context.extraInfo.tenantId);
          }
          if(event && event.message) {
            context.message = event.message.input;
          } else {
            context.message = '1'; // Default to skip location sharing
          }
          return Promise.resolve();
        },
        onDone: [
          {
            target: '#confirmLocation',
            cond: (context, event) => event.data,
            actions: assign((context, event) => {
              context.pgr.detectedLocation = event.data;
            })
          },
          {
            // In sandbox mode, if location was provided but city not detected, still proceed to locality selection
            target: '#locality',
            cond: (context, event) => !event.data && context.slots.pgr.geocode && config.isSandboxMode,
            actions: assign((context, event) => {
              // Set city to organization code (tenant)
              context.slots.pgr.city = context.extraInfo.tenantId;
              // Location coordinates are already saved in context.slots.pgr.geocode
            })
          },
          {
            // In sandbox mode, skip city selection but go to locality selection
            target: '#locality',
            cond: (context, event) => !event.data && context.message ==='1' && config.isSandboxMode,
            actions: assign((context, event) => {
              // Set city to organization code (tenant)
              context.slots.pgr.city = context.extraInfo.tenantId;
              // Don't set locality yet - let user select it
            })
          },
          {
            target: '#city',
            cond: (context, event) => !event.data && context.message ==='1' && !config.pgrUseCase.geoSearch && !config.isSandboxMode

          },
          {
            target: '#nlpCitySearch',
            cond: (context, event) => !event.data && context.message ==='1' && config.pgrUseCase.geoSearch && !config.isSandboxMode
          },
          {
            target: '#geoLocation',
            cond: (context, event) => !event.data && context.message !='1' && !context.slots.pgr.geocode,
            actions: assign((context, event) => {
              let message = dialog.get_message(dialog.global_messages.error.retry, context.user.locale);
              dialog.sendMessage(context, message,false);
            })
          }
        ],
        onError: [
          {
            // In sandbox mode, go to locality selection
            target: '#locality',
            cond: (context, event) => config.isSandboxMode,
            actions: assign((context, event) => {
              // Set city to organization code (tenant)
              context.slots.pgr.city = context.extraInfo.tenantId;
              // Don't set locality yet - let user select it
            })
          },
          {
            target: '#city',
            cond: (context, event) => !config.pgrUseCase.geoSearch && !config.isSandboxMode,

          },
          {
            target: '#nlpCitySearch',
            cond: (context, event) => config.pgrUseCase.geoSearch && !config.isSandboxMode,
          }

        ],
      },
    }
  }
},
confirmLocation: {
  id: 'confirmLocation',
  initial: 'question',
  states: {
    question: {
      onEntry: assign((context, event) => {
        let message;
        if(context.pgr.detectedLocation.locality) {
          let localityName = dialog.get_message(context.pgr.detectedLocation.matchedLocalityMessageBundle, context.user.locale);
          message = dialog.get_message(messages.fileComplaint.confirmLocation.confirmCityAndLocality, context.user.locale);
          message = message.replace('{{locality}}', localityName);
        } else {
          message = dialog.get_message(messages.fileComplaint.confirmLocation.confirmCity, context.user.locale);                      
        }
        let cityName = dialog.get_message(context.pgr.detectedLocation.matchedCityMessageBundle, context.user.locale);
        message = message.replace('{{city}}', cityName);
        dialog.sendMessage(context, message);
      }),
      on: {
        USER_MESSAGE: 'process'
      }
    },
    process: {
      onEntry: assign((context, event) => {
        // TODO: Generalised "disagree" intention
        if(event.message.input.trim().toLowerCase() === '1') {
          context.slots.pgr["locationConfirmed"] = false;
          context.message = {
            isValid: true
          };
        } 
        else if(event.message.input.trim().toLowerCase() === '2'){
          context.slots.pgr["locationConfirmed"] = true;
          context.slots.pgr.city = context.pgr.detectedLocation.city;
          if(context.pgr.detectedLocation.locality) {
            context.slots.pgr.locality = context.pgr.detectedLocation.locality;
          }

          context.message = {
            isValid: true
          };
        }

        else {
          context.message = {
            isValid: false
          };
        }
      }),
      always: [
        {
          target: '#persistComplaint',
          cond: (context, event) => context.message.isValid && context.slots.pgr["locationConfirmed"]  && context.slots.pgr["locality"]
        },
        {
          // In sandbox mode, go to locality selection if location not confirmed
          target: '#locality',
          cond: (context, event) => context.message.isValid && config.isSandboxMode && !context.slots.pgr["locationConfirmed"],
          actions: assign((context, event) => {
            // Set city to organization code (tenant)
            context.slots.pgr.city = context.extraInfo.tenantId;
            // Don't set locality yet - let user select it
          })
        },
        {
          target: '#locality',
          cond: (context, event) => context.message.isValid && !config.pgrUseCase.geoSearch && context.slots.pgr["locationConfirmed"] && !config.isSandboxMode
        },
        {
          target: '#nlpLocalitySearch',
          cond: (context, event) => context.message.isValid && config.pgrUseCase.geoSearch && context.slots.pgr["locationConfirmed"] && !config.isSandboxMode
        },
        {
          target: '#city',
          cond: (context, event) => context.message.isValid && !config.pgrUseCase.geoSearch && !config.isSandboxMode,

        },
        {
          target: '#nlpCitySearch',
          cond: (context, event) => context.message.isValid && config.pgrUseCase.geoSearch && !config.isSandboxMode,
        },
        {
          target: 'process',
          cond: (context, event) => {return !context.message.isValid;}                    
        }
      ]
    }
  }
},
nlpCitySearch: {
  id: 'nlpCitySearch',
  initial: 'question',
  states: {
    question: {
      onEntry: assign((context, event) => {
        let message = dialog.get_message(messages.fileComplaint.cityFuzzySearch.question, context.user.locale)
        dialog.sendMessage(context, message);
      }),
      on: {
        USER_MESSAGE: 'process'
      }
    },
    process: {
      invoke: {
        id: 'cityFuzzySearch',
        src: (context, event) => {
          try {
            // Add null checking for event structure
            if (event && event.message && event.message.input) {
              return pgrService.getCity(event.message.input, context.user.locale, context.extraInfo.tenantId);
            } else {
              // Handle case where event.message is undefined
              return Promise.resolve(null);
            }
          } catch (error) {
            return Promise.resolve(null);
          }
        },
        onDone: {
          target: 'route',
          cond: (context, event) => event.data,
          actions: assign((context, event) => {
            let {predictedCityCode, predictedCity, isCityDataMatch} = event.data;
            context.slots.pgr["predictedCityCode"] = predictedCityCode;
            context.slots.pgr["predictedCity"] = predictedCity;
            context.slots.pgr["isCityDataMatch"] = isCityDataMatch;
            context.slots.pgr["city"] = predictedCityCode;
          })
        }, 
        onError: {
          target: '#system_error'
        }

      },
    },
    route:{
      onEntry: assign((context, event) => {
      }),
      always: [
        {
          target: '#nlpLocalitySearch',
          cond: (context) => context.slots.pgr["isCityDataMatch"] && context.slots.pgr["predictedCity"] != null && context.slots.pgr["predictedCityCode"] != null
        },
        {
          target: '#confirmationFuzzyCitySearch',
          cond: (context) => !context.slots.pgr["isCityDataMatch"] && context.slots.pgr["predictedCity"] != null && context.slots.pgr["predictedCityCode"] != null
        },
        {
          target: '#nlpCitySearch',
          cond: (context) => !context.slots.pgr["isCityDataMatch"] && context.slots.pgr["predictedCity"] == null && context.slots.pgr["predictedCityCode"] == null,
          actions: assign((context, event) => {
            let message = dialog.get_message(messages.fileComplaint.cityFuzzySearch.noRecord, context.user.locale)
            dialog.sendMessage(context, message);
          })

        }
      ]

    },
    confirmationFuzzyCitySearch:{
      id: 'confirmationFuzzyCitySearch',
      initial: 'question',
      states:{
        question: {
          onEntry: assign((context, event) => {
            let message = dialog.get_message(messages.fileComplaint.cityFuzzySearch.confirmation, context.user.locale);
            message = message.replace('{{city}}',context.slots.pgr["predictedCity"]);
            dialog.sendMessage(context, message);
          }),
          on: {
            USER_MESSAGE: 'process'
          }
        },
        process: {
          onEntry: assign((context, event) => {
            if(dialog.validateInputType(event, 'text'))
              context.intention = dialog.get_intention(grammer.confirmation.choice, event, true);
            else
              context.intention = dialog.INTENTION_UNKOWN;
          }),
          always: [
            {
              target: '#nlpLocalitySearch',
              cond: (context) => context.intention == 'Yes'
            },
            {
              target: '#nlpCitySearch',
              cond: (context) => context.intention == 'No',
            },
            {
              target: 'error',
            }
          ]
        },
        error: {
          onEntry: assign((context, event) => {
            let message = dialog.get_message(dialog.global_messages.error.retry, context.user.locale);
            dialog.sendMessage(context, message, false);
          }),
          always: 'question'
        }

      }

    }
  }  
},
nlpLocalitySearch: {
  id: 'nlpLocalitySearch',
  initial: 'question',
  states: {
    question: {
      onEntry: assign((context, event) => {
        let message = dialog.get_message(messages.fileComplaint.localityFuzzySearch.question, context.user.locale)
        dialog.sendMessage(context, message);
      }),
      on: {
        USER_MESSAGE: 'process'
      }
    },
    process: {
      invoke: {
        id: 'localityFuzzySearch',
        src: (context, event) => {
          try {
            // Add null checking for event structure
            if (event && event.message && event.message.input) {
              return pgrService.getLocality(event.message.input, context.slots.pgr["city"], context.user.locale, context.extraInfo.tenantId, context.user);
            } else {
              // Handle case where event.message is undefined
              return Promise.resolve(null);
            }
          } catch (error) {
            return Promise.resolve(null);
          }
        },
        onDone: {
          target: 'route',
          cond: (context, event) => event.data,
          actions: assign((context, event) => {
            let {predictedLocalityCode, predictedLocality, isLocalityDataMatch} = event.data;
            context.slots.pgr["predictedLocalityCode"] = predictedLocalityCode;
            context.slots.pgr["predictedLocality"] = predictedLocality;
            context.slots.pgr["isLocalityDataMatch"] = isLocalityDataMatch;
            context.slots.pgr["locality"] = predictedLocalityCode;
          })
        }, 
        onError: {
          target: '#system_error'
        }
      },
    },
    route:{
      onEntry: assign((context, event) => {
      }),
      always: [
        {
          target: '#persistComplaint',
          cond: (context) => context.slots.pgr["isLocalityDataMatch"] && context.slots.pgr["predictedLocality"] != null && context.slots.pgr["predictedLocalityCode"] != null
        },
        {
          target: '#confirmationFuzzyLocalitySearch',
          cond: (context) => !context.slots.pgr["isLocalityDataMatch"] && context.slots.pgr["predictedLocality"] != null && context.slots.pgr["predictedLocalityCode"] != null
        },
        {
          target: '#nlpLocalitySearch',
          cond: (context) => !context.slots.pgr["isLocalityDataMatch"] && context.slots.pgr["predictedLocality"] == null && context.slots.pgr["predictedLocalityCode"] == null,
          actions: assign((context, event) => {
            let message = dialog.get_message(messages.fileComplaint.localityFuzzySearch.noRecord, context.user.locale)
            dialog.sendMessage(context, message);
          })

        }
      ]

    },
    confirmationFuzzyLocalitySearch:{
      id: 'confirmationFuzzyLocalitySearch',
      initial: 'question',
      states:{
        question: {
          onEntry: assign((context, event) => {
            let message = dialog.get_message(messages.fileComplaint.localityFuzzySearch.confirmation, context.user.locale);
            message = message.replace('{{locality}}',context.slots.pgr["predictedLocality"]);
            dialog.sendMessage(context, message);
          }),
          on: {
            USER_MESSAGE: 'process'
          }
        },
        process: {
          onEntry: assign((context, event) => {
            if(dialog.validateInputType(event, 'text'))
              context.intention = dialog.get_intention(grammer.confirmation.choice, event, true);
            else
              context.intention = dialog.INTENTION_UNKOWN;
          }),
          always: [
            {
              target: '#persistComplaint',
              cond: (context) => context.intention == 'Yes'
            },
            {
              target: '#nlpLocalitySearch',
              cond: (context) => context.intention == 'No',
            },
            {
              target: 'error',
            }
          ]
        },
        error: {
          onEntry: assign((context, event) => {
            let message = dialog.get_message(dialog.global_messages.error.retry, context.user.locale);
            dialog.sendMessage(context, message, false);
          }),
          always: 'question'
        }

      }

    }
  }
},
city: {
  id: 'city',
  onEntry: assign((context, event) => {
  }),
  initial: 'question',
  states: {
    question: {
      invoke: {
        id: 'pgrFetchCities',
        src: (context, event) => pgrService.fetchCitiesAndWebpageLink(context.extraInfo.tenantId,context.extraInfo.whatsAppBusinessNumber),
        onDone: {
          actions: assign((context, event) => {
            let { cities, messageBundle } = event.data;
            let preamble = dialog.get_message(messages.fileComplaint.city.question.preamble, context.user.locale);
            let {prompt, grammer} = dialog.constructListPromptAndGrammer(cities, messageBundle, context.user.locale);
            context.grammer = grammer;
            dialog.sendMessage(context, `${preamble}${prompt}`);
          })
        },
        onError: {
          target: '#system_error'
        }
      },
      on: {
        USER_MESSAGE: 'process'
      }
    },
    process: {
      onEntry:  assign((context, event) => {
        context.intention = dialog.get_intention(context.grammer, event) 
      }),
      always : [
        {
          target: '#locality',
          cond: (context) => context.intention != dialog.INTENTION_UNKOWN,
          actions: assign((context, event) => context.slots.pgr["city"] = context.intention)    
        },
        {
          target: 'error',
        }, 
      ]
    },
    error: {
      onEntry: assign( (context, event) => {
        dialog.sendMessage(context, dialog.get_message(dialog.global_messages.error.retry, context.user.locale), false);
      }),
      always:  'question',
    }
  }
},
locality: {
  id: 'locality',
  initial: 'question',
  states: {
    question: {
      invoke: {
        id: 'pgrFetchLocalities',
        src: (context) => pgrService.fetchLocalitiesAndWebpageLink(context.slots.pgr.city, context.extraInfo.whatsAppBusinessNumber, context.user),
        onDone: {
          actions: assign((context, event) => {
            let { localities, messageBundle } = event.data;
            let preamble = dialog.get_message(messages.fileComplaint.locality.question.preamble, context.user.locale);
            let {prompt, grammer} = dialog.constructListPromptAndGrammer(localities, messageBundle, context.user.locale);
            context.grammer = grammer;
            dialog.sendMessage(context, `${preamble}${prompt}`);
          })
        },
        onError: {
          target: '#system_error'
        }
      },
      on: {
        USER_MESSAGE: 'process'
      }
    },
    process: {
      onEntry:  assign((context, event) => {
        context.intention = dialog.get_intention(context.grammer, event) 
      }),
      always : [
        {
          target: '#persistComplaint',
          cond: (context) => context.intention != dialog.INTENTION_UNKOWN,
          actions: assign((context, event) => context.slots.pgr["locality"] = context.intention)
        },
        {
          target: 'error',
        }, 
      ]
    },
    error: {
      onEntry: assign( (context, event) => {
        dialog.sendMessage(context, dialog.get_message(dialog.global_messages.error.retry, context.user.locale), false);
      }),
      always:  'question',
    }
  }
},
landmark: {
  // come here when user 1) did not provide geolocation or 2) did not confirm geolocation - either because google maps got it wrong or if there was a google api error 

}
});
