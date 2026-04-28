const { assign } = require('xstate');
const { pgrService } = require('./service/service-loader');
const dialog = require('./util/dialog');
const localisationService = require('./util/localisation-service');
const config = require('../env-variables');
const moment = require("moment-timezone");
let event;
const pgr =  {
  id: 'pgr',
  initial: 'fileComplaint',
  onEntry: assign((context, event) => {
    context.slots.pgr = {}
    context.pgr = {slots: {}};
  }),
  states: {
    fileComplaint: {
      id: 'fileComplaint',
      initial: 'type',
      states: {
        type: {
          id: 'pgrType',
          initial: 'complaintType2Step',
          states: {
            complaintType: {
              id: 'complaintType',
              initial: 'question',
              states: {
                question: {
                  invoke: {
                    src: (context) => pgrService.fetchFrequentComplaints(context.extraInfo.tenantId),
                    id: 'fetchFrequentComplaints',
                    onDone: {
                      actions: assign((context, event) => {
                        let preamble = dialog.get_message(messages.fileComplaint.complaintType.question.preamble, context.user.locale);
                        let {complaintTypes, messageBundle} = event.data;
                        let {prompt, grammer} = dialog.constructListPromptAndGrammer(complaintTypes, messageBundle, context.user.locale, true);
                        context.grammer = grammer; // save the grammer in context to be used in next step
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
                }, //question
                process: {
                  onEntry: assign((context, event) => {
                    context.intention = dialog.get_intention(context.grammer, event) 
                  }),
                  always: [
                    {
                      target: '#complaintType2Step',
                      cond: (context) => context.intention == dialog.INTENTION_MORE
                    },
                    {
                      target: '#location',
                      cond: (context) => context.intention != dialog.INTENTION_UNKOWN,
                      actions: assign((context, event) => {
                        context.slots.pgr["complaint"]= context.intention;
                      })
                    },
                    {
                      target: 'error'
                    }
                  ]
                }, // process
                error: {
                  onEntry: assign( (context, event) => {
                    dialog.sendMessage(context, dialog.get_message(dialog.global_messages.error.retry, context.user.locale), false);
                  }),
                  always: 'question',
                } // error
              } // states of complaintType
            }, // complaintType
            complaintType2Step: {
              id: 'complaintType2Step',
              initial: 'complaintCategory',
              states: {
                complaintCategory: {
                  id: 'complaintCategory',
                  initial: 'question',
                  states: {
                    question: {
                      invoke:  {                  
                        src: (context, event)=>pgrService.fetchComplaintCategories(context.extraInfo.tenantId),
                        id: 'fetchComplaintCategories',
                        onDone: {
                          actions: assign((context, event) => {
                            let { complaintCategories, messageBundle } = event.data;
                            let preamble = dialog.get_message(messages.fileComplaint.complaintType2Step.category.question.preamble, context.user.locale);
                            let {prompt, grammer} = dialog.constructListPromptAndGrammer(complaintCategories, messageBundle, context.user.locale);

                            let lengthOfList = grammer.length;
                            let otherTypeGrammer = { intention: 'Others', recognize: [ (lengthOfList + 1).toString() ] };
                            prompt += `\n*${lengthOfList + 1}.* ` + dialog.get_message(messages.fileComplaint.complaintType2Step.category.question.otherType, context.user.locale);
                            grammer.push(otherTypeGrammer);

                            context.grammer = grammer; // save the grammer in context to be used in next step
                            dialog.sendMessage(context, `${preamble}${prompt}`);
                          }),
                        }, 
                        onError: {
                          target: '#system_error'
                        }
                      },
                      on: {
                        USER_MESSAGE: 'process'
                      }
                    }, //question
                    process: {
                      onEntry: assign((context, event) => {
                        context.intention = dialog.get_intention(context.grammer, event, true) 
                      }),
                      always: [
                        {
                          target: '#other',
                          cond: (context) => context.intention == 'Others',
                          actions: assign((context, event) => {
                            context.slots.pgr["complaint"] = context.intention;
                          })
                        },
                        {
                          target: '#complaintItem',
                          cond: (context) => context.intention != dialog.INTENTION_UNKOWN,
                          actions: assign((context, event) => {
                            context.slots.pgr["complaint"] = context.intention;
                          })
                        },
                        {
                          target: 'error'
                        }
                      ]
                    }, // process
                    error: {
                      onEntry: assign( (context, event) => {
                        dialog.sendMessage(context, dialog.get_message(dialog.global_messages.error.retry, context.user.locale), false);
                      }),
                      always:  'question',
                    } // error
                  } // states of complaintCategory
                }, // complaintCategory
                complaintItem: {
                  id: 'complaintItem',
                  initial: 'question',
                  states: {
                    question: {
                      invoke:  {                  
                        src: (context) => pgrService.fetchComplaintItemsForCategory(context.slots.pgr.complaint,context.extraInfo.tenantId),
                        id: 'fetchComplaintItemsForCategory',
                        onDone: {
                          actions: assign((context, event) => {
                            let { complaintItems, messageBundle } = event.data;
                            let preamble = dialog.get_message(messages.fileComplaint.complaintType2Step.item.question.preamble, context.user.locale);
                            let localisationPrefix = 'CS_COMPLAINT_TYPE_';
                            let complaintType = localisationService.getMessageBundleForCode(localisationPrefix + context.slots.pgr.complaint.toUpperCase());
                            let complaint = dialog.get_message(context.slots.pgr.complaint,context.user.locale);
                            if(complaint != undefined)
                              preamble = preamble.replace('{{complaint}}', complaint);
                            else
                              preamble = preamble.replace('{{complaint}}', context.slots.pgr.complaint);
                            
                            let {prompt, grammer} = dialog.constructListPromptAndGrammer(complaintItems, messageBundle, context.user.locale, false, true);
                            context.grammer = grammer; // save the grammer in context to be used in next step
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
                    }, //question
                    process: {
                      onEntry: assign((context, event) => {
                        context.intention = dialog.get_intention(context.grammer, event, true) 
                      }),
                      always: [
                        {
                          target: '#complaintCategory',
                          cond: (context) => context.intention == dialog.INTENTION_GOBACK
                        },
                        {
                          target: '#other',
                          cond: (context) => context.intention != dialog.INTENTION_UNKOWN,
                          actions: assign((context, event) => {
                            context.slots.pgr["complaint"]= context.intention;
                          })
                        },
                        {
                          target: 'error'
                        }
                      ]
                    }, // process
                    error: {
                      onEntry: assign( (context, event) => {
                        dialog.sendMessage(context, dialog.get_message(dialog.global_messages.error.retry, context.user.locale), false);
                      }),
                      always:  'question',
                    } // error
                  } // states of complaintItem
                }, // complaintItem
              } // states of complaintType2Step
            }, // complaintType2Step
          }
        },
        location: {
          id: 'location',
          initial: 'geoLocationSharingInfo',
          states: {
            geoLocationSharingInfo: {
              id: 'geoLocationSharingInfo',
              onEntry: assign( (context, event) => {
                var message = {
                  type: 'image',
                  output: config.pgrUseCase.informationImageFilestoreId
                };
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
                        target: '#city',
                        cond: (context, event) => !event.data && context.message ==='1' && !config.pgrUseCase.geoSearch
                        
                      },
                      {
                        target: '#nlpCitySearch',
                        cond: (context, event) => !event.data && context.message ==='1' && config.pgrUseCase.geoSearch
                      },
                      {
                        target: '#geoLocation',
                        cond: (context, event) => !event.data && context.message !='1',
                        actions: assign((context, event) => {
                          let message = dialog.get_message(dialog.global_messages.error.retry, context.user.locale);
                          dialog.sendMessage(context, message,false);
                        })
                      }
                    ],
                    onError: [
                      {
                        target: '#city',
                        cond: (context, event) => !config.pgrUseCase.geoSearch,

                      },
                      {
                        target: '#nlpCitySearch',
                        cond: (context, event) => config.pgrUseCase.geoSearch,
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
                      target: '#locality',
                      cond: (context, event) => context.message.isValid && !config.pgrUseCase.geoSearch && context.slots.pgr["locationConfirmed"] 
                    },
                    {
                      target: '#nlpLocalitySearch',
                      cond: (context, event) => context.message.isValid && config.pgrUseCase.geoSearch && context.slots.pgr["locationConfirmed"] 
                    },
                    {
                      target: '#city',
                      cond: (context, event) => context.message.isValid && !config.pgrUseCase.geoSearch,

                    },
                    {
                      target: '#nlpCitySearch',
                      cond: (context, event) => context.message.isValid && config.pgrUseCase.geoSearch,
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
                        console.error("Error in PGR city search:", error);
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
                          return pgrService.getLocality(event.message.input, context.slots.pgr["city"], context.user.locale, context.extraInfo.tenantId);
                        } else {
                          // Handle case where event.message is undefined
                          console.error("Invalid event structure for PGR locality search:", event);
                          return Promise.resolve(null);
                        }
                      } catch (error) {
                        console.error("Error in PGR locality search:", error);
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
                    src: (context) => pgrService.fetchLocalitiesAndWebpageLink(context.slots.pgr.city,context.extraInfo.whatsAppBusinessNumber),
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
          }
        },
        other: {
          // get other info
          id: 'other',
          initial: 'imageUpload',
          states: {
            imageUpload: {
              id: 'imageUpload',
              initial: 'question',
              states: {
                question: {
                  onEntry: assign((context, event) => {
                    let message = dialog.get_message(messages.fileComplaint.imageUpload.question, context.user.locale);
                    dialog.sendMessage(context, message);
                  }),
                  on: {
                    USER_MESSAGE: 'process'
                  }
                },
                process: {
                  onEntry: assign((context, event) => {
                    if(dialog.validateInputType(event, 'image')) {
                      context.slots.pgr.image = event.message.input;
                      context.message = {
                        isValid: true
                      };
                    }
                    else{
                      let parsed = event.message.input;
                      let isValid = (parsed === "1");
                      context.message = {
                        isValid: isValid,
                        messageContent: event.message.input
                      };
                    }
                  }),
                  always:[
                    {
                      target: 'error',
                      cond: (context, event) => {
                        return ! context.message.isValid;
                      }
                    },
                    {
                      target: '#location',
                      cond: (context, event) => {
                        return context.message.isValid;
                      }
                    }
                  ] 
                },
                error: {
                  onEntry: assign( (context, event) => {
                    let message = dialog.get_message(dialog.global_messages.error.retry, context.user.locale);
                    dialog.sendMessage(context, message, false);
                  }),
                  always : 'question'
                }
              }
            }
          }
        },
        persistComplaint: {
          id: 'persistComplaint',
          invoke: {
            id: 'persistComplaint',
            src: (context) => pgrService.persistComplaint(context.user,context.slots.pgr,context.extraInfo),
            onDone: {
              target: '#endstate',
              actions: assign((context, event) => {
                let templateList;
                let complaintDetails = event.data;
                let message = dialog.get_message(messages.fileComplaint.persistComplaint, context.user.locale);
                
                // Add null checks for complaintDetails
                if (complaintDetails && complaintDetails.complaintNumber) {
                  message = message.replace('{{complaintNumber}}', complaintDetails.complaintNumber);
                } else {
                  console.warn('Complaint details or complaint number is missing');
                  message = message.replace('{{complaintNumber}}', 'N/A');
                }
                
                if (complaintDetails && complaintDetails.complaintLink) {
                  message = message.replace('{{complaintLink}}', complaintDetails.complaintLink);
                } else {
                  console.warn('Complaint link is missing');
                  message = message.replace('{{complaintLink}}', '#');
                }
                
                let closingStatement = dialog.get_message(messages.fileComplaint.closingStatement, context.user.locale);
                message = message + closingStatement;
                dialog.sendMessage(context, message);
              //  let localeList = config.supportedLocales.split(',');
               // let localeIndex = localeList.indexOf(context.user.locale);
               // templateList =  config.valueFirstWhatsAppProvider.valuefirstNotificationLodgeCompliantTemplateid.split(',');
                
               // if(templateList[localeIndex])
                //  context.extraInfo.templateId = templateList[localeIndex];
               // else
                //  context.extraInfo.templateId = templateList[0];

                //let params=[];
                //params.push(complaintDetails.complaintNumber);

                //let urlComponemt = complaintDetails.complaintLink.split('/');
                //let bttnUrlComponent = urlComponemt[urlComponemt.length -1];

               // var templateContent = {
                //  output: context.extraInfo.templateId,
                 // type: "template",
                 // params: params,
                 // bttnUrlComponent: bttnUrlComponent
               // };

               // dialog.sendMessage(context, templateContent, true);
              })
            }
          }
        },
      }, // fileComplaint.states
    }  // fileComplaint
  } // pgr.states
}; // pgr

let messages = {
  fileComplaint: {
    complaintType: {
      question: {
        preamble: {
          en_IN : 'What is the complaint about ? Please type and send the number of your option 👇',
          hi_IN : 'कृपया अपनी शिकायत के लिए नंबर दर्ज करें'
        },
        other: {
          en_IN : 'Other ...',
          hi_IN : 'कुछ अन्य ...'
        }
      }
    }, // complaintType
    complaintType2Step: {
      category: {
        question: {
          preamble: {
            en_IN : 'Please type and send the number to select a complaint type from the list below 👇\n',
            hi_IN : 'नीचे दी गई सूची से शिकायत प्रकार चुनने के लिए विकल्प संख्या टाइप करें और भेजें 👇'
          },
          otherType: {
            en_IN: 'Others',
            hi_IN: 'अन्य'
          }
        }
      },
      item: {
        question: {
          preamble : {
            en_IN : 'What is the problem you are facing with {{complaint}}?\n',
            hi_IN : 'आपको {{complaint}} से क्या समस्या आ रही है',
            pa_IN : '{{complaint}} ਨਾਲ ਤੁਸੀਂ ਕਿਸ ਸਮੱਸਿਆ ਦਾ ਸਾਹਮਣਾ ਕਰ ਰਹੇ ਹੋ',
          },
        }
      },
    }, // complaintType2Step
    geoLocation: {
      question: {
        en_IN :'Please share your location if you are at the grievance site.\n\n👉  Refer the image below to understand steps for sharing the location.\n\n👉  To continue without sharing the location, type and send  *1*.',
        hi_IN : 'यदि आप शिकायत स्थल पर हैं तो कृपया अपना स्थान साझा करें।\n\n👉 स्थान साझा करने के चरणों को समझने के लिए नीचे दी गई छवि देखें।\n\n👉 स्थान साझा किए बिना जारी रखने के लिए, टाइप करें और 1 भेजें।',
        pa_IN : 'ਜੇ ਤੁਸੀਂ ਸ਼ਿਕਾਇਤ ਵਾਲੀ ਥਾਂ ਤੇ ਹੋ ਤਾਂ ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਸਥਾਨ ਸਾਂਝਾ ਕਰੋ.\n\n👉 ਸਥਾਨ ਨੂੰ ਸਾਂਝਾ ਕਰਨ ਦੇ ਕਦਮਾਂ ਨੂੰ ਸਮਝਣ ਲਈ ਹੇਠ ਦਿੱਤੇ ਚਿੱਤਰ ਨੂੰ ਵੇਖੋ.\n\n👉 ਨਿਰਧਾਰਤ ਸਥਾਨ ਸਾਂਝਾ ਕੀਤੇ ਬਗੈਰ ਜਾਰੀ ਰੱਖਣ ਲਈ, 1 ਲਿਖੋ ਅਤੇ ਭੇਜੋ.'
      }
    }, // geoLocation 
    confirmLocation: {
      confirmCityAndLocality: {
        en_IN: 'Is this the correct location of the complaint?\nCity: {{city}}\nLocality: {{locality}}\n\nType and send *1* if it is incorrect\nElse, type and send *2* to confirm and proceed',
        hi_IN: 'क्या यह शिकायत का सही स्थान है?\शहर: {{city}}\स्थान: {{locality}}\n\nटाइप करें और 1 भेजें यदि यह गलत है\nअन्यथा, पुष्टि करने और आगे बढ़ने के लिए 2 टाइप करें और भेजें',
        pa_IN: 'ਕੀ ਇਹ ਸ਼ਿਕਾਇਤ ਦਾ ਸਹੀ ਸਥਾਨ ਹੈ?\ਸ਼ਹਿਰ: {{city}}\ਸਥਾਨ: {{locality}}\n\nਟਾਈਪ ਕਰੋ ਅਤੇ 1 ਭੇਜੋ ਜੇ ਇਹ ਗਲਤ ਹੈ\nਹੋਰ, ਪੁਸ਼ਟੀ ਕਰਨ ਅਤੇ ਅੱਗੇ ਵਧਣ ਲਈ ਟਾਈਪ ਕਰੋ ਅਤੇ 2 ਭੇਜੋ'
      },
      confirmCity: {
        en_IN: 'Is this the correct location of the complaint?\nCity: {{city}}\n\nType and send *1* if it is incorrect\nElse, type and send *2* to confirm and proceed',
        hi_IN: 'क्या यह शिकायत का सही स्थान है? \nशहर: {{city}}\n अगर यह गलत है तो कृपया "No" भेजें।\nअन्यथा किसी भी चरित्र को टाइप करें और आगे बढ़ने के लिए भेजें।'
      }
    },
    city: {
      question: {
        preamble: {
          en_IN: 'Please type and send the number to select your city from the list below 👇\n',
          hi_IN: 'नीचे दी गई सूची से अपने शहर का चयन करने के लिए विकल्प संख्या टाइप करें और भेजें 👇\n'
        }
      }
    }, // city
    locality: {
      question: {
        preamble: {
          en_IN: 'Please type and send the number to select your locality from the list below 👇\n',
          hi_IN: 'नीचे दी गई सूची से अपने इलाके का चयन करने के लिए विकल्प संख्या टाइप करें और भेजें 👇\n'
        }
      }
    }, // locality
    imageUpload: {
      question: {
        en_IN: 'If possible, attach a photo of your grievance.\n\nTo continue without photo, type and send *1*',
        hi_IN: 'यदि संभव हो तो अपनी शिकायत का फोटो संलग्न करें।\n\nफोटो के बिना जारी रखने के लिए, टाइप करें और 1 भेजें',
        pa_IN: ' ਨਾਮ ਦੀ ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ 1 ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ'
      },
      error:{
        en_IN : 'Sorry, I didn\'t understand',
        hi_IN: 'क्षमा करें, मुझे समझ नहीं आया ।',
      }
    },
    persistComplaint: {
      en_IN: 'Thank You 😃 Your complaint is registered successfully with eGov.\n\nThe Complaint No is : *{{complaintNumber}}*\n\nClick on the link below to view and track your complaint:\n{{complaintLink}}\n',
      hi_IN: 'धन्यवाद 😃 आपकी शिकायत eGov के साथ सफलतापूर्वक दर्ज हो गई है।\nशिकायत संख्या है: {{complaintNumber}}\n अपनी शिकायत देखने और ट्रैक करने के लिए नीचे दिए गए लिंक पर क्लिक करें:\n {{complaintLink}}\n',
      pa_IN: 'ਧੰਨਵਾਦ 😃 ਤੁਹਾਡੀ ਸ਼ਿਕਾਇਤ eGov ਨਾਲ ਸਫਲਤਾਪੂਰਵਕ ਰਜਿਸਟਰ ਹੋਈ ਹੈ.\nਸ਼ਿਕਾਇਤ ਨੰਬਰ ਹੈ: {{complaintNumber}}\n ਆਪਣੀ ਸ਼ਿਕਾਇਤ ਨੂੰ ਵੇਖਣ ਅਤੇ ਟਰੈਕ ਕਰਨ ਲਈ ਹੇਠਾਂ ਦਿੱਤੇ ਲਿੰਕ ਤੇ ਕਲਿੱਕ ਕਰੋ:\n {{complaintLink}}\n'
    },
    closingStatement: {
      en_IN: '\nIn case of any help please type and send "egov"',
      hi_IN: '\nकिसी भी मदद के मामले में कृपया "egov" टाइप करें और भेजें',
      pa_IN: '\nਕਿਸੇ ਵੀ ਮਦਦ ਦੀ ਸਥਿਤੀ ਵਿੱਚ, ਕਿਰਪਾ ਕਰਕੇ ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ'
    },
    cityFuzzySearch: {
      question: {
        en_IN: "Enter the name of your city.\n\n(For example - CityA)",
        hi_IN: "अपने शहर का नाम दर्ज करें। (उदाहरण के लिए - CityA)",
        pa_IN: "ਆਪਣੇ ਸ਼ਹਿਰ ਦਾ ਨਾਮ ਦਰਜ ਕਰੋ. (ਉਦਾਹਰਣ ਵਜੋਂ - CityA)"
      },
      confirmation: {
        en_IN: "Did you mean *“{{city}}”* ?\n\n👉  Type and send *1* to confirm.\n\n👉  Type and send *2* to write again.",
        hi_IN: "क्या आपका मतलब *“{{city}}”* से था ?\n\n👉 टाइप करें और पुष्टि करने के लिए 1 भेजें।\n\n👉 टाइप करें और फिर से लिखने के लिए 2 भेजें।",
        pa_IN: "ਕੀ ਤੁਹਾਡਾ ਮਤਲਬ *“{{city}}”* ਹੈ ?\n\n👉 ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ 1 ਲਿਖੋ ਅਤੇ ਭੇਜੋ.\n\n👉 ਟਾਈਪ ਕਰੋ ਅਤੇ ਦੁਬਾਰਾ ਲਿਖਣ ਲਈ 2 ਭੇਜੋ."
      },
      noRecord:{
        en_IN: 'Provided city is miss-spelled or not present in our system record.\nPlease enter the details again.',
        hi_IN: 'आपके द्वारा दर्ज किया गया शहर गलत वर्तनी वाला है या हमारे सिस्टम रिकॉर्ड में मौजूद नहीं है।\nकृपया फिर से विवरण दर्ज करें।'
      }
    },
    localityFuzzySearch: {
      question: {
        en_IN: "Enter the name of your locality.\n\n(For example - Evergreen Park)",
        hi_IN: "अपने इलाके का नाम दर्ज करें। (उदाहरण के लिए - Evergreen Park)",
        pa_IN: "ਆਪਣੇ ਸਥਾਨ ਦਾ ਨਾਮ ਦਰਜ ਕਰੋ. (ਉਦਾਹਰਣ ਵਜੋਂ - Evergreen Park)"
      },
      confirmation: {
        en_IN: "Did you mean *“{{locality}}”* ?\n\n👉  Type and send *1* to confirm.\n\n👉  Type and send *2* to write again.",
        hi_IN: "क्या आपका मतलब *“{{locality}}”* से था ?\n\n👉 टाइप करें और पुष्टि करने के लिए 1 भेजें।\n\n👉 टाइप करें और फिर से लिखने के लिए 2 भेजें।",
        pa_IN: "ਕੀ ਤੁਹਾਡਾ ਮਤਲਬ *“{{locality}}”* ਹੈ ?\n\n👉 ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ 1 ਲਿਖੋ ਅਤੇ ਭੇਜੋ.\n\n👉 ਟਾਈਪ ਕਰੋ ਅਤੇ ਦੁਬਾਰਾ ਲਿਖਣ ਲਈ 2 ਭੇਜੋ."      
      },
      noRecord:{
        en_IN: 'Provided locality is miss-spelled or not present in our system record.\nPlease enter the details again.',
        hi_IN: 'आपके द्वारा दर्ज किया गया स्थान गलत वर्तनी वाला है या हमारे सिस्टम रिकॉर्ड में मौजूद नहीं है।\nकृपया फिर से विवरण दर्ज करें।'
      }
    }
  }
}; // messages

let grammer = {
  confirmation: {
    choice: [
      {intention: 'Yes', recognize: ['1',]},
      {intention: 'No', recognize: ['2']}
    ]
  }
};
module.exports = pgr;
