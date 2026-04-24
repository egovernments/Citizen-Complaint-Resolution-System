const { assign, actions } = require("xstate");
const { swachService } = require("./service/service-loader");
const dialog = require("./util/dialog");
const localisationService = require("./util/localisation-service");
const config = require("../env-variables");
const { route } = require("../app");
const { initial, cond, invoke } = require("lodash");
const { on } = require("form-data");
const { target } = require("./seva");
const { error } = require("../session/system");
const { onEntry } = require("./pgr");

const swach = {
  id: "swach",
  initial: "swachmenu",
  onEntry: assign((context, event) => {
    // console.log("Swach Initial Context ------- ", context);
    context.slots.swach = {};
    context.swach = { slots: {} };
    context.attendence = {};
    context.slots.attendence = {};
    context.grammer = [];
  }),
  states: {
    swachmenu: {
      id: "swachmenu",
      initial: "question",
      states: {
        question: {
          /*onEntry: assign( (context, event) => {
            dialog.sendMessage(context, dialog.get_message(messages.swachmenu.question, context.user.locale));
          }),
          on: {
            USER_MESSAGE: 'process'
          }*/
          always: [
            {
              target: "#swachFileComplaint",
              cond: (context) =>
                context.intention == "file_new_swach_complaint",
            },
            {
              target: "#swachTrackComplaint",
              cond: (context) =>
                context.intention == "track_existing_swach_complaints",
            },
            {
              target: "#swachAttendance",
              cond: (context) => context.intention == "attendence",
            },
            {
              target: "error",
            },
          ],
        }, // swachmenu.question
        process: {
          onEntry: assign(
            (context, event) =>
              (context.intention = dialog.get_intention(
                grammer.swachmenu.question,
                event
              ))
          ),
          always: [
            {
              target: "#swachFileComplaint",
              cond: (context) =>
                context.intention == "file_new_swach_complaint",
            },
            {
              target: "#swachTrackComplaint",
              cond: (context) =>
                context.intention == "track_existing_swach_complaints",
            },
            {
              target: "#swachAttendance",
              cond: (context) => context.intention == "attendence",
            },
            {
              target: "error",
            },
          ],
        }, // swachmenu.process
        error: {
          onEntry: assign((context, event) =>
            dialog.sendMessage(
              context,
              dialog.get_message(
                dialog.global_messages.error.retry,
                context.user.locale
              ),
              false
            )
          ),
          always: "question",
        }, // swachmenu.error
      }, // swachmenu.states
    },

    swachAttendance: {
      id: "swachAttendance",
      initial: "question",
      states: {
        question: {
          onEntry: assign((context, event) => {
            let message = dialog.get_message(
              messages.swachAttendance.question,
              context.user.locale
            );
            dialog.sendMessage(context, message);
          }),
          on: {
            USER_MESSAGE: "process",
          },
        },
        process: {
          onEntry: assign((context, event) => {
            if (dialog.validateInputType(event, "image")) {
              // console.log("Swach Image Upload ------- type image", event.message);
              context.attendence.image = event.message.input;
              // context.attendence.metadata = event.message.metadata;
              // if(event.message.metadata && event.message.metadata.latitude && event.message.metadata.longitude) {
              context.message = {
                isValid: true,
                // isImageError: false,
              };
              // } else{
              //   context.message = {
              //     isValid: true,
              //     isImageError: true,
              //   };
              // }
              // console.log("Swach Image Upload ------- context", context);
            } else {
              context.message = {
                isValid: false,
              };
            }
          }),
          always: [
            {
              target: "error",
              cond: (context, event) => {
                return !context.message.isValid;
              },
            },
            // {
            //   target: "imageError",
            //   cond: (context, event) => {
            //     return context.message.isImageError;
            //   },
            // },
            {
              target: "#swachAttendenceGeoLocationSharingInfo",
              cond: (context, event) => {
                // return (context.message.isValid && !context.message.isImageError);
                return context.message.isValid;
              },
            },
          ],
        },
        error: {
          onEntry: assign((context, event) => {
            let message = dialog.get_message(
              dialog.global_messages.error.retry,
              context.user.locale
            );
            dialog.sendMessage(context, message, false);
          }),
          always: "question",
        },
        // imageError: {
        //   onEntry: assign((context, event) => {
        //     let message = dialog.get_message(
        //       dialog.global_messages.image_error.retry,
        //       context.user.locale
        //     );
        //     dialog.sendMessage(context, message, false);
        //   }),
        //   always: "question",
        // }
      }, // states of swachAttendance
    },

    swachAttendenceGeoLocationSharingInfo: {
      id: "swachAttendenceGeoLocationSharingInfo",
      onEntry: assign((context, event) => {
        var message = {
          type: "image",
          output: config.swachUseCase.informationImageFilestoreId, //need review
        };
        dialog.sendMessage(context, message);
      }),
      always: "swachAttendenceGeoLocation",
    },

    swachAttendenceGeoLocation: {
      id: "swachAttendenceGeoLocation",
      initial: "question",
      states: {
        question: {
          onEntry: assign((context, event) => {
            let message = dialog.get_message(
              messages.swachFileComplaint.swachAttendenceGeoLocation.question,
              context.user.locale
            );
            dialog.sendMessage(context, message);
          }),
          on: {
            USER_MESSAGE: "process",
          },
        },
        process: {
          invoke: {
            id: "getSwachAttendenceCityAndLocality",
            src: async (context, event) => {
              if (event?.message.type === "location") {
                context.slots.attendence.geocode = event.message.input;
                context.message = {
                  isValid: true,
                };
                return await swachService.getCityAndLocalityForGeocode(
                  event.message.input,
                  context.extraInfo.tenantId
                );
              } else {
                context.message = event.message.input;
                context.message = {
                  isValid: false,
                };
                // context.message = "1";
                return Promise.resolve();
              }

              // if(context.slots.swach.metadata.latitude && context.slots.swach.metadata.longitude) {
              //   context.slots.swach.geocode = '('+ context.slots.swach.metadata.latitude + ',' + context.slots.swach.metadata.longitude + ')';
              //   console.log("Swach City and Locality", context.slots.swach.geocode);
              //   // return swachService.getCityAndLocalityForGeocode(
              //   //   context.slots.swach.geocode,
              //   //   context.extraInfo.tenantId
              //   // )
              // }
            },
            onDone: [
              {
                target: "#swachAttendenceConfirmLocation",
                cond: (context, event) => event.data && context.message.isValid,
                actions: assign((context, event) => {
                  // console.log("Swach Attendence GeoLocation ------- event", event);
                  context.attendence.detectedLocation = event.data;
                }),
              },
              // {
              //   target: "#swachNLPAttendanceCitySearch",
              //   cond: (context, event) =>
              //     !event.data &&
              //     context.message === "1",
              // },
              {
                target: "#swachNLPAttendanceCitySearch",
                cond: (context, event) =>
                  !event.data && context.message.isValid,
                // && context.message != "1",
                actions: assign((context, event) => {
                  // console.log("Swach Attendence GeoLocation 2 ------- context", context);
                  let message = dialog.get_message(
                    // dialog.global_messages.error.retry,
                    messages.swachAttendance.retry,
                    context.user.locale
                  );
                  dialog.sendMessage(context, message, false);
                }),
              },
              {
                target: "#swachAttendenceGeoLocationSharingInfo",
                cond: (context, event) =>
                  !event.data && !context.message.isValid,
                // && context.message != "1",
                actions: assign((context, event) => {
                  // console.log("Swach Attendence GeoLocation 2 ------- context", context);
                  let message = dialog.get_message(
                    dialog.global_messages.error.retry,
                    // messages.swachAttendance.retry,
                    context.user.locale
                  );
                  dialog.sendMessage(context, message, false);
                }),
              },
            ],
            onError: [
              {
                target: "#swachNLPAttendanceCitySearch",
              },
            ],
          },
        },
      },
    },

    swachAttendenceConfirmLocation: {
      id: "swachAttendenceConfirmLocation",
      initial: "question",
      states: {
        question: {
          onEntry: assign((context, event) => {
            let message;
            if (context.attendence.detectedLocation.locality) {
              let localityName = dialog.get_message(
                context.attendence.detectedLocation
                  .matchedLocalityMessageBundle,
                context.user.locale
              );
              message = dialog.get_message(
                messages.swachFileComplaint.swachAttendanceConfirmLocation
                  .confirmCityAndLocality,
                context.user.locale
              );
              message = message.replace("{{locality}}", localityName);
            } else {
              message = dialog.get_message(
                messages.swachFileComplaint.swachAttendanceConfirmLocation
                  .confirmCity,
                context.user.locale
              );
            }
            let cityName = dialog.get_message(
              context.attendence.detectedLocation.matchedCityMessageBundle,
              context.user.locale
            );
            message = message.replace("{{city}}", cityName);
            dialog.sendMessage(context, message);
          }),
          on: {
            USER_MESSAGE: "process",
          },
        },
        process: {
          onEntry: assign((context, event) => {
            // TODO: Generalised "disagree" intention
            if (event.message?.input?.trim()?.toLowerCase() === "2") {
              context.slots.attendence["locationConfirmed"] = false;
              context.message = {
                isValid: true,
              };
            } else if (event.message?.input?.trim()?.toLowerCase() === "1") {
              context.slots.attendence["locationConfirmed"] = true;
              context.slots.attendence.city =
                context.attendence.detectedLocation.city;
              if (context.attendence.detectedLocation.locality) {
                context.slots.attendence.locality =
                  context.attendence.detectedLocation.locality;
              }

              context.message = {
                isValid: true,
              };
            } else {
              context.message = {
                isValid: false,
              };
            }
          }),
          always: [
            {
              target: "#persistAttendence",
              cond: (context, event) =>
                context.message.isValid &&
                context.slots.attendence["locationConfirmed"] &&
                context.slots.attendence["locality"],
            },
            {
              target: "#swachNLPAttendanceLocalitySearch",
              cond: (context, event) =>
                context.message.isValid &&
                context.slots.attendence["locationConfirmed"],
            },
            {
              target: "#swachNLPAttendanceCitySearch",
              cond: (context, event) => context.message.isValid,
            },
            {
              target: "#swachAttendenceConfirmLocation",
              cond: (context, event) => {
                return !context.message.isValid;
              },
              actions: assign((context, event) => {
                let message = dialog.get_message(
                  dialog.global_messages.error.retry,
                  context.user.locale
                );
                dialog.sendMessage(context, message, false);
              }),
            },
          ],
        },
      },
    },

    swachNLPAttendanceCitySearch: {
      id: "swachNLPAttendanceCitySearch",
      initial: "question",
      states: {
        question: {
          onEntry: assign((context, event) => {
            let message = dialog.get_message(
              messages.swachFileComplaint.swachCityFuzzySearch.question,
              context.user.locale
            );
            dialog.sendMessage(context, message);
          }),
          on: {
            USER_MESSAGE: "process",
          },
        },
        process: {
          invoke: {
            id: "swachAttendenceCityFuzzySearch",
            src: (context, event) => {
              try {
                // console.log("Swach Get City")
                // Add null checking for event structure
                if (event && event.message && event.message.input) {
                  return swachService.getCity(
                    event.message.input,
                    context.user.locale,
                    context.extraInfo.tenantId
                  );
                } else {
                  // Handle case where event.message is undefined
                  return Promise.resolve(null);
                }
              } catch (error) {
                return Promise.resolve(null);
              }
            },
            onDone: {
              target: "route",
              cond: (context, event) => event.data,
              actions: assign((context, event) => {
                let { predictedCityCode, predictedCity, isCityDataMatch } =
                  event.data;
                context.slots.attendence["predictedCityCode"] =
                  predictedCityCode;
                context.slots.attendence["predictedCity"] = predictedCity;
                context.slots.attendence["isCityDataMatch"] = isCityDataMatch;
                context.slots.attendence["city"] = predictedCityCode;
              }),
            },
            onError: {
              target: "#system_error",
            },
          },
        },
        route: {
          onEntry: assign((context, event) => {}),
          always: [
            {
              target: "#swachNLPAttendanceLocalitySearch",
              cond: (context) =>
                context.slots.attendence["isCityDataMatch"] &&
                context.slots.attendence["predictedCity"] != null &&
                context.slots.attendence["predictedCityCode"] != null,
            },
            {
              target: "#swachConfirmationAttendanceFuzzyCitySearch",
              cond: (context) =>
                !context.slots.attendence["isCityDataMatch"] &&
                context.slots.attendence["predictedCity"] != null &&
                context.slots.attendence["predictedCityCode"] != null,
            },
            {
              target: "#swachNLPAttendanceCitySearch",
              cond: (context) =>
                !context.slots.attendence["isCityDataMatch"] &&
                context.slots.attendence["predictedCity"] == null &&
                context.slots.attendence["predictedCityCode"] == null,
              actions: assign((context, event) => {
                let message = dialog.get_message(
                  messages.swachFileComplaint.swachCityFuzzySearch.noRecord,
                  context.user.locale
                );
                dialog.sendMessage(context, message);
              }),
            },
          ],
        },
        swachConfirmationAttendanceFuzzyCitySearch: {
          id: "swachConfirmationAttendanceFuzzyCitySearch",
          initial: "question",
          states: {
            question: {
              onEntry: assign((context, event) => {
                let message = dialog.get_message(
                  messages.swachFileComplaint.swachCityFuzzySearch.confirmation,
                  context.user.locale
                );
                message = message.replace(
                  "{{city}}",
                  context.slots.attendence["predictedCity"]
                );
                dialog.sendMessage(context, message);
              }),
              on: {
                USER_MESSAGE: "process",
              },
            },
            process: {
              onEntry: assign((context, event) => {
                if (dialog.validateInputType(event, "text"))
                  context.intention = dialog.get_intention(
                    grammer.confirmation.choice,
                    event,
                    true
                  );
                else context.intention = dialog.INTENTION_UNKOWN;
              }),
              always: [
                {
                  target: "#swachNLPAttendanceLocalitySearch",
                  cond: (context) => context.intention == "Yes",
                },
                {
                  target: "#swachNLPAttendanceCitySearch",
                  cond: (context) => context.intention == "No",
                },
                {
                  target: "error",
                },
              ],
            },
            error: {
              onEntry: assign((context, event) => {
                dialog.sendMessage(
                  context,
                  dialog.get_message(
                    dialog.global_messages.error.retry,
                    context.user.locale
                  ),
                  false
                );
              }),
              always: "question",
            }, // error
          },
        },
      },
    },

    swachNLPAttendanceLocalitySearch: {
      id: "swachNLPAttendanceLocalitySearch",
      initial: "question",
      states: {
        question: {
          onEntry: assign((context, event) => {
            let message = dialog.get_message(
              messages.swachFileComplaint.swachNlpLocalitySearch.question,
              context.user.locale
            );
            dialog.sendMessage(context, message);
          }),
          on: {
            USER_MESSAGE: "process",
          },
        },
        process: {
          invoke: {
            id: "swachAttendenceLocalityFuzzySearch",
            src: (context, event) => {
              try {
                // console.log("Swach Get City")
                // Add null checking for event structure
                if (event && event.message && event.message.input) {
                  return swachService.getLocality(
                    event.message.input,
                    context.slots.attendence["city"],
                    context.user.locale,
                    context.extraInfo.tenantId
                  );
                } else {
                  // Handle case where event.message is undefined
                  console.error("Invalid event structure for attendance locality search:", event);
                  return Promise.resolve(null);
                }
              } catch (error) {
                console.error("Error in attendance locality search:", error);
                return Promise.resolve(null);
              }
            },
            onDone: {
              target: "route",
              cond: (context, event) => event.data,
              actions: assign((context, event) => {
                let {
                  predictedLocalityCode,
                  predictedLocality,
                  isLocalityDataMatch,
                } = event.data;
                context.slots.attendence["predictedLocalityCode"] =
                  predictedLocalityCode;
                context.slots.attendence["predictedLocality"] =
                  predictedLocality;
                context.slots.attendence["isLocalityDataMatch"] =
                  isLocalityDataMatch;
                context.slots.attendence["locality"] = predictedLocalityCode;
              }),
            },
            onError: {
              target: "#system_error",
            },
          },
        },
        route: {
          onEntry: assign((context, event) => {}),
          always: [
            {
              target: "#persistAttendence", // persistAttendence
              cond: (context) =>
                context.slots.attendence["isLocalityDataMatch"] &&
                context.slots.attendence["predictedLocality"] != null &&
                context.slots.attendence["predictedLocalityCode"] != null,
            },
            {
              target: "#swachConfirmationAttendanceFuzzyLocalitySearch",
              cond: (context) =>
                !context.slots.attendence["isLocalityDataMatch"] &&
                context.slots.attendence["predictedLocality"] != null &&
                context.slots.attendence["predictedLocalityCode"] != null,
            },
            // {
            //   target: "#swachNLPAttendanceLocalitySearch",
            //   cond: (context) =>
            //     !context.slots.attendence["isLocalityDataMatch"] &&
            //     context.slots.attendence["predictedLocality"] == null &&
            //     context.slots.attendence["predictedLocalityCode"] == null,
            //   actions: assign((context, event) => {
            //     let message = dialog.get_message(
            //       messages.swachFileComplaint.swachNlpLocalitySearch.noRecord,
            //       context.user.locale
            //     );
            //     dialog.sendMessage(context, message);
            //   }),
            // }
            {
              target: "#swachConfirmationAttendanceFuzzyLocalitySearch",
              cond: (context) =>
                !context.slots.attendence["isLocalityDataMatch"] &&
                context.slots.attendence["predictedLocality"] == null &&
                context.slots.attendence["predictedLocalityCode"] == null,
              actions: assign((context, event) => {
                context.slots.attendence["predictedLocalityCode"] = "UNKNOWN";
                context.slots.attendence["predictedLocality"] = "UNKNOWN";
                context.slots.attendence["locality"] = "UNKNOWN";
                let message = dialog.get_message(
                  messages.swachAttendance.noRecord,
                  context.user.locale
                );
                dialog.sendMessage(context, message);
              }),
            },
          ],
        },
        swachConfirmationAttendanceFuzzyLocalitySearch: {
          id: "swachConfirmationAttendanceFuzzyLocalitySearch",
          initial: "question",
          states: {
            question: {
              onEntry: assign((context, event) => {
                let message = dialog.get_message(
                  messages.swachFileComplaint.swachNlpLocalitySearch
                    .confirmation,
                  context.user.locale
                );
                // console.log("Final Context ------ ", context);
                message = message.replace(
                  "{{locality}}",
                  context.slots.attendence["predictedLocality"]
                );
                dialog.sendMessage(context, message);
              }),
              on: {
                USER_MESSAGE: "process",
              },
            },
            process: {
              onEntry: assign((context, event) => {
                if (dialog.validateInputType(event, "text"))
                  context.intention = dialog.get_intention(
                    grammer.confirmation.choice,
                    event,
                    true
                  );
                else context.intention = dialog.INTENTION_UNKOWN;
              }),
              always: [
                {
                  target: "#persistAttendence", // persistAttendence
                  cond: (context) => context.intention == "Yes",
                },
                {
                  target: "#swachNLPAttendanceLocalitySearch",
                  cond: (context) => context.intention == "No",
                },
                {
                  target: "error",
                },
              ],
            },
            error: {
              onEntry: assign((context, event) => {
                dialog.sendMessage(
                  context,
                  dialog.get_message(
                    dialog.global_messages.error.retry,
                    context.user.locale
                  ),
                  false
                );
              }),
              always: "question",
            },
          },
        },
      },
    },

    // persistAttendence: {
    //   id: "persistAttendence",
    //   invoke: {
    //     id: "persistAttendence",
    //     src: (context, event) => {
    //       // console.log("Swach Persist Attendence ------- context", context);
    //       return swachService.persistAttendence(
    //         context.user,
    //         context.slots.attendence,
    //         context.attendence,
    //         context.extraInfo.tenantId
    //       );
    //     },
    //     onDone: {
    //       target: "#swachWelcome",
    //       actions: assign((context, event) => {
    //         // console.log("Swach Persist Attendence ------- event", event);
    //         if(event.data) {
    //         let message = dialog.get_message(
    //           messages.swachAttendance.confirmation,
    //           context.user.locale
    //         );
    //         context.intention = null;
    //         dialog.sendMessage(context, message);
    //         }else{
    //           let message = dialog.get_message(
    //             dialog.global_messages.system_error,
    //             context.user.locale
    //           );
    //           dialog.sendMessage(context, message);
    //           context.chatInterface.system_error(event.data);
    //         }
    //       }),
    //     },
    //   },
    // },

    // swachFileComplaint
    persistAttendence: {
      id: "persistAttendence",
      invoke: {
        id: "persistAttendence",
        src: async (context) => {
          try {
            const result = await swachService.persistAttendence(
              context.user,
              context.slots.attendence,
              context.attendence,
              context.extraInfo.tenantId
            );

            let message;
            if (result) {
              message = dialog.get_message(
                messages.swachAttendance.confirmation,
                context.user.locale
              );
              context.intention = null;
            } else {
              message = dialog.get_message(
                dialog.global_messages.system_error,
                context.user.locale
              );
              context.chatInterface.system_error(result);
            }

            await dialog.sendMessage(context, message, true);
            await new Promise((resolve) => setTimeout(resolve, 1000)); // Optional buffer
            return { success: true };
          } catch (err) {
            let message = dialog.get_message(
              dialog.global_messages.system_error,
              context.user.locale
            );
            await dialog.sendMessage(context, message, true);
            context.chatInterface.system_error(err);
            return { success: false };
          }
        },
        onDone: {
          target: "#swachWelcome",
        },
      },
    },

    swachFileComplaint: {
      id: "swachFileComplaint",
      initial: "type",
      states: {
        type: {
          id: "swachType",
          initial: "swachComplaintType2Step",
          states: {
            swachcomplaintType: {
              id: "swachcomplaintType",
              initial: "question",
              states: {
                question: {
                  invoke: {
                    src: (context) => {
                      return swachService.fetchSwachFrequentComplaints(
                        context.extraInfo.tenantId
                      );
                    },
                    id: "fetchSwachFrequentComplaints",
                    onDone: {
                      actions: assign((context, event) => {
                        let preamble = dialog.get_message(
                          messages.swachFileComplaint.swachcomplaintType
                            .question.preamble,
                          context.user.locale
                        );
                        let { complaintTypes, messageBundle } = event.data;
                        let { prompt, grammer } =
                          dialog.constructListPromptAndGrammer(
                            complaintTypes,
                            messageBundle,
                            context.user.locale,
                            true
                          );
                        context.grammer = grammer; // save the grammer in context to be used in next step
                        dialog.sendMessage(context, `${preamble}${prompt}`);
                      }),
                    },
                    onError: {
                      target: "#system_error",
                    },
                  },
                  on: {
                    USER_MESSAGE: "process",
                  },
                }, //question
                process: {
                  onEntry: assign((context, event) => {
                    context.intention = dialog.get_intention(
                      context.grammer,
                      event
                    );
                  }),
                  always: [
                    {
                      target: "#swachComplaintType2Step",
                      cond: (context) =>
                        context.intention == dialog.INTENTION_MORE,
                    },
                    {
                      target: "#swachLocation",
                      cond: (context) =>
                        context.intention != dialog.INTENTION_UNKOWN,
                      actions: assign((context, event) => {
                        return (context.slots.swach["complaint"] =
                          context.intention);
                      }),
                    },
                    {
                      target: "error",
                    },
                  ],
                }, // process
                error: {
                  onEntry: assign((context, event) => {
                    dialog.sendMessage(
                      context,
                      dialog.get_message(
                        dialog.global_messages.error.retry,
                        context.user.locale
                      ),
                      false
                    );
                  }),
                  always: "question",
                }, // error
              }, // states of complaintType
            }, // complaintType
            swachComplaintType2Step: {
              id: "swachComplaintType2Step",
              initial: "swachComplaintItem",
              states: {
                swachComplaintCategory: {
                  id: "swachComplaintCategory",
                  initial: "question",
                  states: {
                    question: {
                      invoke: {
                        src: (context, event) => {
                          // console.log("context at swachComplaintCategory :", context);
                          return swachService.fetchSwachComplaintCategories(
                            context.extraInfo.tenantId
                          );
                        },
                        id: "fetchSwachComplaintCategories",
                        onDone: {
                          actions: assign((context, event) => {
                            let { complaintCategories, messageBundle } =
                              event.data;
                            let preamble = dialog.get_message(
                              messages.swachFileComplaint
                                .swachComplaintType2Step.category.question
                                .preamble,
                              context.user.locale
                            );
                            let { prompt, grammer } =
                              dialog.constructListPromptAndGrammer(
                                complaintCategories,
                                messageBundle,
                                context.user.locale
                              );

                            let lengthOfList = grammer.length;
                            let otherTypeGrammer = {
                              intention: "Others",
                              recognize: [(lengthOfList + 1).toString()],
                            };
                            prompt +=
                              `\n*${lengthOfList + 1}.* ` +
                              dialog.get_message(
                                messages.swachFileComplaint
                                  .swachComplaintType2Step.category.question
                                  .otherType,
                                context.user.locale
                              );
                            grammer.push(otherTypeGrammer);

                            context.grammer = grammer; // save the grammer in context to be used in next step
                            dialog.sendMessage(context, `${preamble}${prompt}`);
                          }),
                        },
                        onError: {
                          target: "#system_error",
                        },
                      },
                      on: {
                        USER_MESSAGE: "process",
                      },
                    }, //question
                    process: {
                      onEntry: assign((context, event) => {
                        context.intention = dialog.get_intention(
                          context.grammer,
                          event,
                          true
                        );
                      }),
                      always: [
                        {
                          target: "#swachOther",
                          cond: (context) => context.intention == "Others",
                          actions: assign((context, event) => {
                            return (context.slots.swach["complaint"] =
                              context.intention);
                          }),
                        },
                        {
                          target: "#swachComplaintItem",
                          cond: (context) =>
                            context.intention != dialog.INTENTION_UNKOWN,
                          actions: assign((context, event) => {
                            return (context.slots.swach["complaint"] =
                              context.intention);
                          }),
                        },
                        {
                          target: "error",
                        },
                      ],
                    }, // process
                    error: {
                      onEntry: assign((context, event) => {
                        dialog.sendMessage(
                          context,
                          dialog.get_message(
                            dialog.global_messages.error.retry,
                            context.user.locale
                          ),
                          false
                        );
                      }),
                      always: "question",
                    }, // error
                  }, // states of swachComplaintCategory
                }, // swachComplaintCategory
                swachComplaintItem: {
                  id: "swachComplaintItem",
                  initial: "question",
                  states: {
                    question: {
                      invoke: {
                        src: (context) => {
                          return swachService.fetchSwatchComplaintItemsForCategory(
                            // context.slots.swach.complaint,
                            context.extraInfo.tenantId
                          );
                        },
                        id: "fetchSwatchComplaintItemsForCategory",
                        onDone: {
                          actions: assign((context, event) => {
                            let { complaintItems, messageBundle } = event.data;

                            let preamble = dialog.get_message(
                              messages.swachFileComplaint
                                .swachComplaintType2Step.item.question.preamble,
                              context.user.locale
                            );

                            // let localisationPrefix = "CS_COMPLAINT_TYPE_";

                            // let complaintType =
                            //   localisationService.getMessageBundleForCode(
                            //     localisationPrefix +
                            //       context?.slots?.swach?.complaint?.toUpperCase()
                            //   );

                            let complaint = dialog.get_message(
                              // context.slots.swach.complaint,
                              "SwachCategory",
                              context.user.locale
                            );

                            preamble = preamble.replace(
                              "{{complaint}}",
                              complaint || context.slots.swach.complaint
                            );

                            // if (complaint != undefined)
                            //   preamble = preamble.replace(
                            //     "{{complaint}}",
                            //     complaint
                            //   );
                            // else
                            //   preamble = preamble.replace(
                            //     "{{complaint}}",
                            //     context.slots.swach.complaint
                            //   );

                            let { prompt, grammer } =
                              dialog.constructListPromptAndGrammer(
                                complaintItems,
                                messageBundle,
                                context.user.locale
                                // false,
                                // true
                              );

                            // let lengthOfList = grammer.length;
                            // let otherTypeGrammer = {
                            //   intention: "Others",
                            //   recognize: [(lengthOfList + 1).toString()],
                            // };
                            // prompt +=
                            //   `\n*${lengthOfList + 1}.* ` +
                            //   dialog.get_message(
                            //     messages.swachFileComplaint
                            //       .swachComplaintType2Step.category.question
                            //       .otherType,
                            //     context.user.locale
                            //   );
                            // grammer.push(otherTypeGrammer);

                            // console.log("Constructed Prompt:", prompt); // Debugging
                            // console.log("Constructed Grammar:", grammer); // Debugging

                            context.grammer = grammer; // save the grammer in context to be used in next step
                            dialog.sendMessage(context, `${preamble}${prompt}`);
                          }),
                        },
                        onError: {
                          target: "#system_error",
                        },
                      },
                      on: {
                        USER_MESSAGE: "process",
                      },
                    }, //question
                    process: {
                      onEntry: assign((context, event) => {
                        context.intention = dialog.get_intention(
                          context.grammer,
                          event,
                          true
                        );
                      }),
                      always: [
                        // {
                        //   target: "#swachComplaintCategory",
                        //   cond: (context) =>
                        //     context.intention == dialog.INTENTION_GOBACK,
                        // },
                        {
                          target: "#swachOther",
                          cond: (context) =>
                            context.intention != dialog.INTENTION_UNKOWN,
                          actions: assign((context, event) => {
                            return (context.slots.swach["complaint"] =
                              context.intention);
                          }),
                        },
                        {
                          target: "error",
                        },
                      ],
                    }, // process
                    error: {
                      onEntry: assign((context, event) => {
                        dialog.sendMessage(
                          context,
                          dialog.get_message(
                            dialog.global_messages.error.retry,
                            context.user.locale
                          ),
                          false
                        );
                      }),
                      always: "question",
                    }, // error
                  }, // states of swachComplaintItem
                }, // swachComplaintItem
              }, // states of swachComplaintType2Step
            }, // swachComplaintType2Step
          },
        },
        swachLocation: {
          id: "swachLocation",
          initial: "swachGeoLocationSharingInfo",
          // initial: "swachGeoLocation",
          states: {
            swachGeoLocationSharingInfo: {
              id: "swachGeoLocationSharingInfo",
              onEntry: assign((context, event) => {
                var message = {
                  type: "image",
                  output: config.swachUseCase.informationImageFilestoreId, //need review
                };
                dialog.sendMessage(context, message);
              }),
              always: "swachGeoLocation",
            },
            swachGeoLocation: {
              id: "swachGeoLocation",
              initial: "question",
              // initial: "process",
              states: {
                question: {
                  onEntry: assign((context, event) => {
                    let message = dialog.get_message(
                      messages.swachFileComplaint.swachGeoLocation.question,
                      context.user.locale
                    );
                    dialog.sendMessage(context, message);
                  }),
                  on: {
                    USER_MESSAGE: "process",
                  },
                },
                process: {
                  invoke: {
                    id: "getSwachCityAndLocality",
                    src: async (context, event) => {
                      try {
                        if (event?.message.type === "location") {
                          context.slots.swach.geocode = event.message.input;
                          context.message = {
                            isValid: true,
                          };
                          console.log(
                            "Swach City and Locality",
                            context.message.isValid
                          );
                          // console.log("Swach City and Locality")
                          return await swachService.getCityAndLocalityForGeocode(
                            event.message.input,
                            context.extraInfo.tenantId
                          );
                        } else {
                          // context.message = event.message.input;
                          const userInput = event.message?.input || ""; 
                          console.log(
                            "Non-location input received:",
                            userInput
                          );

                          context.message = {
                            isValid: false,
                            userInput: userInput, 
                            error: "Expected location type",
                          };
                          return Promise.resolve();
                        }
                        // if(context.slots.swach.metadata.latitude && context.slots.swach.metadata.longitude) {
                        //   context.slots.swach.geocode = '('+ context.slots.swach.metadata.latitude + ',' + context.slots.swach.metadata.longitude + ')';
                        //   console.log("Swach City and Locality", context.slots.swach.geocode);
                        //   // return swachService.getCityAndLocalityForGeocode(
                        //   //   context.slots.swach.geocode,
                        //   //   context.extraInfo.tenantId
                        //   // )
                        // }
                        // context.message = event.message.input;
                        // context.message = "1";
                        // return Promise.resolve();
                      } catch (error) {
                        console.error(
                          "Error in getSwachCityAndLocality:",
                          error
                        );
                        context.message = {
                          isValid: false,
                          
                        };
                        return Promise.resolve(); 
                      }
                    },
                    onDone: [
                      {
                        target: "#swachConfirmLocation",
                        cond: (context, event) =>
                          event.data && context.message.isValid,
                        actions: assign((context, event) => {
                          context.swach.detectedLocation = event.data;
                        }),
                      },
                      // {
                      //   target: "#swachCity",
                      //   cond: (context, event) =>
                      //     !event.data &&
                      //     context.message === "1" &&
                      //     !config.swachUseCase.geoSearch,   //need review
                      //   actions: assign((context, event) => {
                      //       let message = dialog.get_message(
                      //         dialog.global_messages.error.retry,
                      //         context.user.locale
                      //       );
                      //       dialog.sendMessage(context, message, false);
                      //     }),
                      // },
                      {
                        target: "#swachNLPCitySearch",
                        cond: (context, event) => {
                          console.log(
                            "Swach City and Locality",
                            context.message.isValid
                          );
                          return (
                            !event.data &&
                            context.message.isValid &&
                            config.swachUseCase.geoSearch
                          );
                        },
                        //need review
                        actions: assign((context, event) => {
                          let message = dialog.get_message(
                            messages.swachAttendance.retry,
                            context.user.locale
                          );
                          dialog.sendMessage(context, message, false);
                        }),
                      },
                      {
                        target: "#swachGeoLocationSharingInfo",
                        cond: (context, event) =>
                          !event.data && !context.message.isValid,
                        //  && context.message != "1",
                        actions: assign((context, event) => {
                          let message = dialog.get_message(
                            dialog.global_messages.error.retry,
                            context.user.locale
                          );
                          dialog.sendMessage(context, message, false);
                        }),
                      },
                    ],
                    onError: [
                      {
                        target: "#swachCity",
                        cond: (context, event) =>
                          !config.swachUseCase.geoSearch, //need review
                      },
                      {
                        target: "#swachNLPCitySearch",
                        cond: (context, event) => config.swachUseCase.geoSearch, //need review
                      },
                    ],
                  },
                },
              },
            },
            swachConfirmLocation: {
              id: "swachConfirmLocation",
              initial: "question",
              states: {
                question: {
                  onEntry: assign((context, event) => {
                    let message;
                    if (context.swach.detectedLocation.locality) {
                      let localityName = dialog.get_message(
                        context.swach.detectedLocation
                          .matchedLocalityMessageBundle,
                        context.user.locale
                      );
                      message = dialog.get_message(
                        messages.swachFileComplaint.swachConfirmLocation
                          .confirmCityAndLocality,
                        context.user.locale
                      );
                      message = message.replace("{{locality}}", localityName);
                    } else {
                      message = dialog.get_message(
                        messages.swachFileComplaint.swachConfirmLocation
                          .confirmCity,
                        context.user.locale
                      );
                    }
                    let cityName = dialog.get_message(
                      context.swach.detectedLocation.matchedCityMessageBundle,
                      context.user.locale
                    );
                    message = message.replace("{{city}}", cityName);
                    dialog.sendMessage(context, message);
                  }),
                  on: {
                    USER_MESSAGE: "process",
                  },
                },
                process: {
                  onEntry: assign((context, event) => {
                    // TODO: Generalised "disagree" intention
                    if (event.message?.input?.trim().toLowerCase() === "2") {
                      context.slots.swach["locationConfirmed"] = false;
                      context.message = {
                        isValid: true,
                      };
                    } else if (
                      event.message?.input?.trim().toLowerCase() === "1"
                    ) {
                      context.slots.swach["locationConfirmed"] = true;
                      context.slots.swach.city =
                        context.swach.detectedLocation.city;
                      if (context.swach.detectedLocation.locality) {
                        context.slots.swach.locality =
                          context.swach.detectedLocation.locality;
                      }

                      context.message = {
                        isValid: true,
                      };
                    } else {
                      context.message = {
                        isValid: false,
                      };
                    }
                  }),
                  always: [
                    {
                      target: "#persistSwachComplaint",
                      cond: (context, event) =>
                        context.message.isValid &&
                        context.slots.swach["locationConfirmed"] &&
                        context.slots.swach["locality"],
                    },
                    {
                      target: "#swachLocality",
                      cond: (context, event) =>
                        context.message.isValid &&
                        !config.swachUseCase.geoSearch && //need review
                        context.slots.swach["locationConfirmed"],
                    },
                    {
                      target: "#swachNlpLocalitySearch",
                      cond: (context, event) =>
                        context.message.isValid &&
                        config.swachUseCase.geoSearch && //need review
                        context.slots.swach["locationConfirmed"],
                    },
                    {
                      target: "#swachCity",
                      cond: (context, event) =>
                        context.message.isValid &&
                        !config.swachUseCase.geoSearch, //need review
                    },
                    {
                      target: "#swachNLPCitySearch",
                      cond: (context, event) =>
                        context.message.isValid &&
                        config.swachUseCase.geoSearch, //need review
                    },
                    {
                      target: "#swachConfirmLocation",
                      cond: (context, event) => {
                        return !context.message.isValid;
                      },
                      actions: assign((context, event) => {
                        let message = dialog.get_message(
                          dialog.global_messages.error.retry,
                          context.user.locale
                        );
                        dialog.sendMessage(context, message, false);
                      }),
                    },
                  ],
                },
              },
            },
            swachNLPCitySearch: {
              id: "swachNLPCitySearch",
              initial: "question",
              states: {
                question: {
                  onEntry: assign((context, event) => {
                    let message = dialog.get_message(
                      messages.swachFileComplaint.swachCityFuzzySearch.question,
                      context.user.locale
                    );
                    dialog.sendMessage(context, message);
                  }),
                  on: {
                    USER_MESSAGE: "process",
                  },
                },
                process: {
                  invoke: {
                    id: "swachCityFuzzySearch",
                    src: (context, event) => {
                      try {
                        // console.log("Swach Get City")
                        // Add null checking for event structure
                        if (event && event.message && event.message.input) {
                          return swachService.getCity(
                            event.message.input,
                            context.user.locale,
                            context.extraInfo.tenantId
                          );
                        } else {
                          // Handle case where event.message is undefined
                          console.error("Invalid event structure for city search:", event);
                          return Promise.resolve(null);
                        }
                      } catch (error) {
                        console.error("Error in city search:", error);
                        return Promise.resolve(null);
                      }
                    },
                    onDone: {
                      target: "route",
                      cond: (context, event) => event.data,
                      actions: assign((context, event) => {
                        let {
                          predictedCityCode,
                          predictedCity,
                          isCityDataMatch,
                        } = event.data;
                        context.slots.swach["predictedCityCode"] =
                          predictedCityCode;
                        context.slots.swach["predictedCity"] = predictedCity;
                        context.slots.swach["isCityDataMatch"] =
                          isCityDataMatch;
                        context.slots.swach["city"] = predictedCityCode;
                      }),
                    },
                    onError: {
                      target: "#system_error",
                    },
                  },
                },
                route: {
                  onEntry: assign((context, event) => {}),
                  always: [
                    {
                      target: "#swachNlpLocalitySearch",
                      cond: (context) =>
                        context.slots.swach["isCityDataMatch"] &&
                        context.slots.swach["predictedCity"] != null &&
                        context.slots.swach["predictedCityCode"] != null,
                    },
                    {
                      target: "#swachConfirmationFuzzyCitySearch",
                      cond: (context) =>
                        !context.slots.swach["isCityDataMatch"] &&
                        context.slots.swach["predictedCity"] != null &&
                        context.slots.swach["predictedCityCode"] != null,
                    },
                    {
                      target: "#swachNLPCitySearch",
                      cond: (context) =>
                        !context.slots.swach["isCityDataMatch"] &&
                        context.slots.swach["predictedCity"] == null &&
                        context.slots.swach["predictedCityCode"] == null,
                      actions: assign((context, event) => {
                        let message = dialog.get_message(
                          messages.swachFileComplaint.swachCityFuzzySearch
                            .noRecord,
                          context.user.locale
                        );
                        dialog.sendMessage(context, message);
                      }),
                    },
                  ],
                },
                swachConfirmationFuzzyCitySearch: {
                  id: "swachConfirmationFuzzyCitySearch",
                  initial: "question",
                  states: {
                    question: {
                      onEntry: assign((context, event) => {
                        let message = dialog.get_message(
                          messages.swachFileComplaint.swachCityFuzzySearch
                            .confirmation,
                          context.user.locale
                        );
                        message = message.replace(
                          "{{city}}",
                          context.slots.swach["predictedCity"]
                        );
                        dialog.sendMessage(context, message);
                      }),
                      on: {
                        USER_MESSAGE: "process",
                      },
                    },
                    process: {
                      onEntry: assign((context, event) => {
                        if (dialog.validateInputType(event, "text"))
                          context.intention = dialog.get_intention(
                            grammer.confirmation.choice,
                            event,
                            true
                          );
                        else context.intention = dialog.INTENTION_UNKOWN;
                      }),
                      always: [
                        {
                          target: "#swachNlpLocalitySearch",
                          cond: (context) => context.intention == "Yes",
                        },
                        {
                          target: "#swachNLPCitySearch",
                          cond: (context) => context.intention == "No",
                        },
                        {
                          target: "error",
                        },
                      ],
                    },
                    error: {
                      onEntry: assign((context, event) => {
                        let message = dialog.get_message(
                          dialog.global_messages.error.retry,
                          context.user.locale
                        );
                        dialog.sendMessage(context, message, false);
                      }),
                      always: "question",
                    },
                  },
                },
              },
            },
            swachNlpLocalitySearch: {
              id: "swachNlpLocalitySearch",
              initial: "question",
              states: {
                question: {
                  onEntry: assign((context, event) => {
                    let message = dialog.get_message(
                      messages.swachFileComplaint.swachNlpLocalitySearch
                        .question,
                      context.user.locale
                    );
                    dialog.sendMessage(context, message);
                  }),
                  on: {
                    USER_MESSAGE: "process",
                  },
                },
                process: {
                  invoke: {
                    id: "swachNlpLocalitySearch",
                    src: (context, event) => {
                      try {
                        if (event && event.message && event.message.input) {
                          return swachService.getLocality(
                            event.message.input,
                            context.slots.swach["city"],
                            context.user.locale,
                            context.extraInfo.tenantId
                          );
                        } else {
                          // Handle missing event.message or event.message.input gracefully
                          return Promise.resolve(null);
                        }
                      } catch (error) {
                        // Log or handle unexpected errors gracefully
                        console.error("Error in swachNlpLocalitySearch src function:", error);
                        return Promise.resolve(null);
                      }
                    },
                    onDone: {
                      target: "route",
                      cond: (context, event) => event.data,
                      actions: assign((context, event) => {
                        let {
                          predictedLocalityCode,
                          predictedLocality,
                          isLocalityDataMatch,
                        } = event.data;
                        context.slots.swach["predictedLocalityCode"] =
                          predictedLocalityCode;
                        context.slots.swach["predictedLocality"] =
                          predictedLocality;
                        context.slots.swach["isLocalityDataMatch"] =
                          isLocalityDataMatch;
                        context.slots.swach["locality"] = predictedLocalityCode;
                      }),
                    },
                    onError: {
                      target: "#system_error",
                    },
                  },
                },
                route: {
                  onEntry: assign((context, event) => {}),
                  always: [
                    {
                      target: "#persistSwachComplaint",
                      cond: (context) =>
                        context.slots.swach["isLocalityDataMatch"] &&
                        context.slots.swach["predictedLocality"] != null &&
                        context.slots.swach["predictedLocalityCode"] != null,
                    },
                    {
                      target: "#swachConfirmationFuzzyLocalitySearch",
                      cond: (context) =>
                        !context.slots.swach["isLocalityDataMatch"] &&
                        context.slots.swach["predictedLocality"] != null &&
                        context.slots.swach["predictedLocalityCode"] != null,
                    },
                    // {
                    //   target: "#swachNlpLocalitySearch",
                    //   cond: (context) =>
                    //     !context.slots.swach["isLocalityDataMatch"] &&
                    //     context.slots.swach["predictedLocality"] == null &&
                    //     context.slots.swach["predictedLocalityCode"] == null,
                    //   actions: assign((context, event) => {
                    //     let message = dialog.get_message(
                    //       messages.swachFileComplaint.swachNlpLocalitySearch
                    //         .noRecord,
                    //       context.user.locale
                    //     );
                    //     dialog.sendMessage(context, message);
                    //   }),
                    // },
                    {
                      target: "#swachConfirmationFuzzyLocalitySearch",
                      cond: (context) =>
                        !context.slots.swach["isLocalityDataMatch"] &&
                        context.slots.swach["predictedLocality"] == null &&
                        context.slots.swach["predictedLocalityCode"] == null,
                      actions: assign((context, event) => {
                        context.slots.swach["predictedLocalityCode"] =
                          "UNKNOWN";
                        context.slots.swach["predictedLocality"] = "UNKNOWN";
                        context.slots.swach["locality"] = "UNKNOWN";
                        let message = dialog.get_message(
                          messages.swachAttendance.noRecord,
                          context.user.locale
                        );
                        dialog.sendMessage(context, message);
                      }),
                    },
                  ],
                },
                swachConfirmationFuzzyLocalitySearch: {
                  id: "swachConfirmationFuzzyLocalitySearch",
                  initial: "question",
                  states: {
                    question: {
                      onEntry: assign((context, event) => {
                        let message = dialog.get_message(
                          messages.swachFileComplaint.swachNlpLocalitySearch
                            .confirmation,
                          context.user.locale
                        );
                        message = message.replace(
                          "{{locality}}",
                          context.slots.swach["predictedLocality"]
                        );
                        dialog.sendMessage(context, message);
                      }),
                      on: {
                        USER_MESSAGE: "process",
                      },
                    },
                    process: {
                      onEntry: assign((context, event) => {
                        if (dialog.validateInputType(event, "text"))
                          context.intention = dialog.get_intention(
                            grammer.confirmation.choice,
                            event,
                            true
                          );
                        else context.intention = dialog.INTENTION_UNKOWN;
                      }),
                      always: [
                        {
                          target: "#persistSwachComplaint",
                          cond: (context) => context.intention == "Yes",
                        },
                        {
                          target: "#swachNlpLocalitySearch",
                          cond: (context) => context.intention == "No",
                        },
                        {
                          target: "error",
                        },
                      ],
                    },
                    error: {
                      onEntry: assign((context, event) => {
                        let message = dialog.get_message(
                          dialog.global_messages.error.retry,
                          context.user.locale
                        );
                        dialog.sendMessage(context, message, false);
                      }),
                      always: "question",
                    },
                  },
                },
              },
            },
            swachCity: {
              id: "swachCity",
              initial: "question",
              states: {
                question: {
                  invoke: {
                    id: "swachFetchCities",
                    src: (context, event) => {
                      // console.log("Swach Cities and Webpage")
                      return swachService.fetchCitiesAndWebpageLink(
                        context.extraInfo.tenantId,
                        context.extraInfo.whatsAppBusinessNumber
                      );
                    },
                    onDone: {
                      actions: assign((context, event) => {
                        let { cities, messageBundle, link } = event.data;
                        let preamble = dialog.get_message(
                          messages.swachFileComplaint.city.question.preamble,
                          context.user.locale
                        );
                        let message = preamble + "\n" + link;
                        let grammer = dialog.constructLiteralGrammer(
                          cities,
                          messageBundle,
                          context.user.locale
                        );
                        context.grammer = grammer;
                        dialog.sendMessage(context, message);
                      }),
                    },
                    onError: {
                      target: "#system_error",
                    },
                  },
                  on: {
                    USER_MESSAGE: "process",
                  },
                },
                process: {
                  onEntry: assign((context, event) => {
                    context.intention = dialog.get_intention(
                      context.grammer,
                      event
                    );
                  }),
                  always: [
                    {
                      target: "#swachLocality",
                      cond: (context) =>
                        context.intention != dialog.INTENTION_UNKOWN,
                      actions: assign(
                        (context, event) =>
                          (context.slots.swach["city"] = context.intention)
                      ),
                    },
                    {
                      target: "error",
                    },
                  ],
                },
                error: {
                  onEntry: assign((context, event) => {
                    dialog.sendMessage(
                      context,
                      dialog.get_message(
                        dialog.global_messages.error.retry,
                        context.user.locale
                      ),
                      false
                    );
                  }),
                  always: "question",
                },
              },
            },
            swachLocality: {
              id: "swachLocality",
              initial: "question",
              states: {
                question: {
                  invoke: {
                    id: "swachFetchLocalities",
                    src: (context) => {
                      // console.log("Swach Get Locality and Webpage")
                      return swachService.fetchLocalitiesAndWebpageLink(
                        context.slots.swach.city,
                        context.extraInfo.whatsAppBusinessNumber
                      );
                    },
                    onDone: {
                      actions: assign((context, event) => {
                        let { localities, messageBundle, link } = event.data;
                        let preamble = dialog.get_message(
                          messages.swachFileComplaint.locality.question
                            .preamble,
                          context.user.locale
                        );
                        let message = preamble + "\n" + link;
                        let grammer = dialog.constructLiteralGrammer(
                          localities,
                          messageBundle,
                          context.user.locale
                        );
                        context.grammer = grammer;
                        dialog.sendMessage(context, message);
                      }),
                    },
                    onError: {
                      target: "#system_error",
                    },
                  },
                  on: {
                    USER_MESSAGE: "process",
                  },
                },
                process: {
                  onEntry: assign((context, event) => {
                    return (context.intention = dialog.get_intention(
                      context.grammer,
                      event
                    ));
                  }),
                  always: [
                    {
                      target: "#persistSwachComplaint",
                      cond: (context) =>
                        context.intention != dialog.INTENTION_UNKOWN,
                      actions: assign(
                        (context, event) =>
                          (context.slots.swach["locality"] = context.intention)
                      ),
                    },
                    {
                      target: "error",
                    },
                  ],
                },
                error: {
                  onEntry: assign((context, event) => {
                    dialog.sendMessage(
                      context,
                      dialog.get_message(
                        dialog.global_messages.error.retry,
                        context.user.locale
                      ),
                      false
                    );
                  }),
                  always: "question",
                },
              },
            },
            swachLandmark: {
              // come here when user 1) did not provide geolocation or 2) did not confirm geolocation - either because google maps got it wrong or if there was a google api error
            },
          },
        },
        swachOther: {
          // get other info
          id: "swachOther",
          initial: "swachImageUpload",
          states: {
            swachImageUpload: {
              id: "swachImageUpload",
              initial: "question",
              states: {
                question: {
                  onEntry: assign((context, event) => {
                    let message = dialog.get_message(
                      messages.swachFileComplaint.swachImageUpload.question,
                      context.user.locale
                    );
                    dialog.sendMessage(context, message);
                  }),
                  on: {
                    USER_MESSAGE: "process",
                  },
                },
                process: {
                  onEntry: assign((context, event) => {
                    if (dialog.validateInputType(event, "image")) {
                      // console.log("Swach Image Upload ------- type image", event.message);
                      context.slots.swach.image = event.message.input;
                      context.message = {
                        isValid: true,
                      };
                      // context.slots.swach.metadata = event.message.metadata;
                      // if(event.message.metadata && event.message.metadata.latitude && event.message.metadata.longitude) {
                      // context.message = {
                      //   isValid: true,
                      //   isImageError: false,
                      // };
                      // } else{
                      //   context.message = {
                      //     isValid: true,
                      //     isImageError: true,
                      //   };
                      // }
                      // console.log("Swach Image Upload ------- context", context);
                    } else {
                      // console.log("Swach Image Upload ------- type not image", event.message.input);
                      // let parsed = event.message.input;
                      // let isValid = parsed === "1";
                      // context.message = {
                      //   isValid: isValid,
                      //   messageContent: event.message.input,
                      // };
                      context.message = {
                        isValid: false,
                      };
                    }
                  }),
                  always: [
                    {
                      target: "error",
                      cond: (context, event) => {
                        // console.log("Swach Image Upload ------- context", context);
                        return !context.message.isValid;
                      },
                    },
                    // {
                    //   target: "imageError",
                    //   cond: (context, event) => {
                    //     return context.message.isImageError;
                    //   },
                    // },
                    {
                      target: "#swachDescription",
                      cond: (context, event) => {
                        // return (context.message.isValid && !context.message.isImageError);
                        return context.message.isValid;
                      },
                    },
                  ],
                },
                error: {
                  onEntry: assign((context, event) => {
                    let message = dialog.get_message(
                      dialog.global_messages.error.retry,
                      context.user.locale
                    );
                    dialog.sendMessage(context, message, false);
                  }),
                  always: "question",
                },
                imageError: {
                  onEntry: assign((context, event) => {
                    let message = dialog.get_message(
                      dialog.global_messages.image_error.retry,
                      context.user.locale
                    );
                    dialog.sendMessage(context, message, false);
                  }),
                  always: "question",
                },
              },
            },
          },
        },
        swachDescription: {
          // get other info
          id: "swachDescription",
          initial: "swachDescriptiondetails",
          states: {
            swachDescriptiondetails: {
              id: "swachDescriptiondetails",
              initial: "question",
              states: {
                question: {
                  onEntry: assign((context, event) => {
                    // console.log("sdsdgsh")
                    let message = dialog.get_message(
                      messages.swachFileComplaint.swachDescription.question,
                      context.user.locale
                    );
                    dialog.sendMessage(context, message);
                  }),
                  on: {
                    USER_MESSAGE: "process",
                  },
                },
                process: {
                  onEntry: assign((context, event) => {
                    if (dialog.validateInputType(event, "text")) {
                      // console.log("Swach Image Upload ------- type image", event.message);
                      context.slots.swach.description = event.message.input;
                      context.message = {
                        isValid: true,
                      };
                    } else {
                      context.message = {
                        isValid: false,
                      };
                    }
                    return (context.intention = dialog.get_intention(
                      context.grammer,
                      event
                    ));
                  }),
                  always: [
                    {
                      target: "#swachLocation",
                      cond: (context, event) => {
                        // return (context.message.isValid && !context.message.isImageError);
                        return context.message.isValid;
                      },
                    },
                    {
                      target: "error",
                    },
                  ],
                },
                error: {
                  onEntry: assign((context, event) => {
                    let message = dialog.get_message(
                      dialog.global_messages.error.retry,
                      context.user.locale
                    );
                    dialog.sendMessage(context, message, false);
                  }),
                  always: "question",
                },
              },
            },
          },
        },
        persistSwachComplaint: {
          id: "persistSwachComplaint",
          invoke: {
            id: "persistSwachComplaint",
            src: async (context) => {
              const complaintDetails = await swachService.persistSwachComplaint(
                context.user,
                context.slots.swach,
                context.extraInfo
              );

              let templateList;
              let message = dialog.get_message(
                messages.swachFileComplaint.persistSwachComplaint,
                context.user.locale
              );
              message = message.replace(
                "{{complaintNumber}}",
                complaintDetails?.complaintNumber
              );

              // const closingStatement = dialog.get_message(
              //   messages.swachFileComplaint.closingStatement,
              //   context.user.locale
              // );

              // message = message + closingStatement;
              message = message;

              await dialog.sendMessage(context, message, true);
              await new Promise((resolve) => setTimeout(resolve, 1000)); // optional buffer before moving on

              return { complaintDetails };
            },
            onDone: {
              target: "#swachWelcome",
            },
          },
        },
      }, // swachFileComplaint.states
    },

    // swachTrackComplaint
    // swachTrackComplaint: {
    //   id: "swachTrackComplaint",
    //   invoke: {
    //     id: "fetchOpenSwachComplaints",
    //     src: (context) => {
    //       return swachService.fetchOpenSwachComplaints(context.user);
    //     },
    //     onDone: [
    //       {
    //         target: "#swachWelcome",
    //         cond: (context, event) => {
    //           return event.data.length > 0;
    //         },
    //         actions: assign((context, event) => {
    //           (async () => {
    //             let templateList;
    //             let localeList = config.supportedLocales.split(",");
    //             let localeIndex = localeList.indexOf(context.user.locale);
    //             templateList =
    //               config.valueFirstWhatsAppProvider.valuefirstNotificationTrackCompliantTemplateid.split(
    //                 ","
    //               );

    //             if (templateList[localeIndex])
    //               context.extraInfo.templateId = templateList[localeIndex];
    //             else context.extraInfo.templateId = templateList[0];

    //             let complaints = event.data;
    //             var preamble = dialog.get_message(
    //               messages.swachTrackComplaint.results.preamble,
    //               context.user.locale
    //             );
    //             dialog.sendMessage(context, preamble, true);
    //             await new Promise((resolve) => setTimeout(resolve, 1000));
    //             for (let i = 0; i < complaints.length; i++) {
    //               let template = dialog.get_message(
    //                 messages.swachTrackComplaint.results.complaintTemplate,
    //                 context.user.locale
    //               );
    //               let complaint = complaints[i];
    //               template = template.replace(
    //                 "{{complaintType}}",
    //                 complaint.complaintType
    //               );
    //               template = template.replace(
    //                 "{{filedDate}}",
    //                 complaint.filedDate
    //               );
    //               template = template.replace(
    //                 "{{complaintStatus}}",
    //                 complaint.complaintStatus
    //               );
    //               // template = template.replace(
    //               //   "{{complaintLink}}",
    //               //   complaint.complaintLink
    //               // );

    //               dialog.sendMessage(context, template, true);
    //               // params.push(complaint.complaintType);
    //               // params.push(complaint.complaintNumber);
    //               // params.push(complaint.filedDate);
    //               // params.push(complaint.complaintStatus);

    //               // let urlComponemt = complaint.complaintLink.split('/');
    //               // let bttnUrlComponent = urlComponemt[urlComponemt.length -1];

    //               // var templateContent = {
    //               //  output: context.extraInfo.templateId,
    //               //  type: "template",
    //               //  params: params,
    //               //  bttnUrlComponent: bttnUrlComponent
    //               // };

    //               // dialog.sendMessage(context, templateContent, true);
    //             }
    //             await new Promise((resolve) => setTimeout(resolve, 1000));
    //             var closingStatement = dialog.get_message(
    //               messages.swachTrackComplaint.results.closingStatement,
    //               context.user.locale
    //             );
    //             dialog.sendMessage(context, closingStatement, true);
    //           })();
    //         }),
    //       },
    //       {
    //         target: "#swachWelcome",
    //         actions: assign((context, event) => {
    //           let message = dialog.get_message(
    //             messages.swachTrackComplaint.noRecords,
    //             context.user.locale
    //           );
    //           dialog.sendMessage(context, message);
    //         }),
    //       },
    //     ],
    //   },
    // },
    swachTrackComplaint: {
      id: "swachTrackComplaint",
      invoke: {
        id: "fetchOpenSwachComplaints",
        src: async (context) => {
          const complaints = await swachService.fetchOpenSwachComplaints(
            context.user
          );

          let templateList;
          let localeList = config.supportedLocales.split(",");
          let localeIndex = localeList.indexOf(context.user.locale);
          templateList =
            config.valueFirstWhatsAppProvider.valuefirstNotificationTrackCompliantTemplateid.split(
              ","
            );

          context.extraInfo.templateId =
            templateList[localeIndex] || templateList[0];

          if (complaints.length > 0) {
            const preamble = dialog.get_message(
              messages.swachTrackComplaint.results.preamble,
              context.user.locale
            );
            await dialog.sendMessage(context, preamble, true);
            await new Promise((resolve) => setTimeout(resolve, 1000));

            for (let complaint of complaints) {
              let template = dialog.get_message(
                messages.swachTrackComplaint.results.complaintTemplate,
                context.user.locale
              );
              template = template
                .replace("{{complaintType}}", complaint.complaintType)
                .replace("{{filedDate}}", complaint.filedDate)
                .replace("{{complaintStatus}}", complaint.complaintStatus);

              await dialog.sendMessage(context, template, true);
              await new Promise((resolve) => setTimeout(resolve, 500));
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // const closingStatement = dialog.get_message(
            //   messages.swachTrackComplaint.results.closingStatement,
            //   context.user.locale
            // );
            // await dialog.sendMessage(context, closingStatement, true);
          }

          return { complaints };
        },
        onDone: [
          {
            cond: (_, event) => event.data && event.data.complaints && Array.isArray(event.data.complaints) && event.data.complaints.length > 0,
            target: "#swachWelcome",
          },
          {
            target: "#swachWelcome",
            actions: assign((context) => {
              const message = dialog.get_message(
                messages.swachTrackComplaint.noRecords,
                context.user.locale
              );
              dialog.sendMessage(context, message);
            }),
          },
        ],
      },
    },
  }, // swach.states
};

// messages
let messages = {
  swachmenu: {
    question: {
      en_IN:
        "Please type and send the number for your option 👇\n\n*1.* Raise Your Observation.\n\n*2.* Track Your Previous Observations.\n\n*3.* Attendance.\n\n 👉  At any stage type and send *swach* to go back to the Swach menu.",
      hi_IN:
        "कृपया अपने विकल्प के लिए नंबर टाइप करें और भेजें 👇\n\n*1.* Swach नई शिकायत दर्ज करें।\n\n*2.* Swach पुरानी शिकायतों की स्थिति देखें\n\n*3.* उपस्थिति\n\n👉 किसी भी चरण में \'egov\' या \'swach\' टाइप करें और भेजें ताकि मुख्य मेनू पर वापस जा सकें।",
      pa_IN:
        "ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੇ ਵਿਕਲਪ ਲਈ ਨੰਬਰ ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ 👇\n\n*1.* Swach ਨਵੀਂ ਸ਼ਿਕਾਇਤ ਦਰਜ ਕਰੋ।\n\n*2.* Swach ਪੁਰਾਣੀਆਂ ਸ਼ਿਕਾਇਤਾਂ ਦੀ ਸਥਿਤੀ ਵੇਖੋ\n\n*3.* ਦਿੱਖ\n\n👉 ਕਿਸੇ ਵੀ ਪੜਾਅ 'ਤੇ *swach* ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ ਤਾਂ ਕਿ ਮੁੱਖ ਮੀਨੂ 'ਚ ਵਾਪਸ ਜਾ ਸਕੋ।",
    },
  },

  swachAttendance: {
    question: {
      en_IN: "Please attach your attendance selfie and send it to us.",
      hi_IN: "कृपया उपस्थिति की छवि संलग्न करें और हमें भेजें।",
      pa_IN: "ਕਿਰਪਾ ਕਰਕੇ ਹਾਜ਼ਰੀ ਦੀ ਤਸਵੀਰ ਜੁੜੀ ਹੋਈ ਹੈ ਅਤੇ ਸਾਨੂੰ ਭੇਜੋ।",
    },
    confirmation: {
      en_IN: "Your Attendence have been successfully submitted. ",
      hi_IN: "आपकी उपस्थिति सफलतापूर्वक प्रस्तुत की गई है।",
      pa_IN: "ਤੁਹਾਡੀ ਹਾਜ਼ਰੀ ਸਫਲਤਾਪੂਰਕ ਪੇਸ਼ ਕੀਤੀ ਗਈ ਹੈ। ",
    },
    noRecord: {
      en_IN:
        "Provided locality is miss-spelled or not present in our system record.\nMoving Forward with Unknown locality.",
      hi_IN:
        "आपके द्वारा दर्ज किया गया स्थान गलत वर्तनी वाला है या हमारे सिस्टम रिकॉर्ड में मौजूद नहीं है।\nअज्ञात स्थानीयता के साथ अग्रेषित किया जा रहा है।",
      pa_IN:
        "ਤੁਹਾਡੇ ਦੁਆਰਾ ਦਰਜ ਕੀਤਾ ਗਿਆ ਸਥਾਨ ਗਲਤ ਵਰਤਨੀ ਵਾਲਾ ਹੈ ਜਾਂ ਸਾਡੇ ਸਿਸਟਮ ਦੇ ਰਿਕਾਰਡ ਵਿੱਚ ਮੌਜੂਦ ਨਹੀਂ ਹੈ।\nਅਣਜਾਣ ਸਥਾਨਕਤਾ ਨਾਲ ਅੱਗੇ ਭੇਜਿਆ ਜਾ ਰਿਹਾ ਹੈ।",
    },
    retry: {
      en_IN: "Selected option seems to be invalid 😐",
      hi_IN: "चुना हुआ विकल्प अमान्य प्रतीत होता है 😐",
      pa_IN: "ਚੁਣਿਆ ਗਿਆ ਵਿਕਲਪ ਅਵੈਧ ਲੱਗਦਾ ਹੈ 😐",
    },
  },

  // swach file complaint
  swachFileComplaint: {
    swachcomplaintType: {
      question: {
        preamble: {
          en_IN:
            "What is the complaint about ? Please type and send the number of your option 👇",
          hi_IN: "कृपया अपनी शिकायत के लिए नंबर दर्ज करें",
          pa_IN: "ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੀ ਸ਼ਿਕਾਇਤ ਲਈ ਨੰਬਰ ਦਰਜ ਕਰੋ",
        },
        other: {
          en_IN: "Other ...",
          hi_IN: "कुछ अन्य ...",
          pa_IN: "ਕੁਝ ਹੋਰ ...",
        },
      },
    }, // complaintType
    swachComplaintType2Step: {
      category: {
        question: {
          preamble: {
            en_IN:
              "Please type and send the number to select a Observation type from the list below 👇\n",
            hi_IN:
              "नीचे दी गई सूची से शिकायत प्रकार चुनने के लिए विकल्प संख्या टाइप करें और भेजें 👇",
            pa_IN:
              "ਕਿਰਪਾ ਕਰਕੇ ਹੇਠਾਂ ਦਿੱਤੀ ਸੂਚੀ ਵਿੱਚੋਂ ਸ਼ਿਕਾਇਤ ਦੇ ਕਿਸਮ ਨੂੰ ਚੁਣਨ ਲਈ ਨੰਬਰ ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ 👇",
          },
          otherType: {
            en_IN: "Others",
            hi_IN: "अन्य",
            pa_IN: "ਹੋਰ",
          },
        },
      },
      newCategory: {
        question: {
          preamble: {
            en_IN:
              "To confirm and raise an observation, please type and send *1*.",
            hi_IN:
              "पुष्टि करने और शिकायत दर्ज करने के लिए कृपया 1 टाइप करें और भेजें।",
            pa_IN:
              "ਪੁਸ਼ਟੀ ਕਰਨ ਅਤੇ ਸ਼ਿਕਾਇਤ ਦਰਜ ਕਰਨ ਲਈ ਕਿਰਪਾ ਕਰਕੇ 1 ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ।",
          },
        },
      },
      item: {
        question: {
          preamble: {
            en_IN: "What is the problem you are facing ?\n",
            hi_IN: "आपको क्या समस्या आ रही है ?\n",
            pa_IN: "ਤੁਹਾਨੂੰ ਕਿਹੜੀ ਸਮੱਸਿਆ ਦਾ ਸਾਹਮਣਾ ਕਰਨਾ ਪੈ ਰਿਹਾ ਹੈ?\n",
          },
        },
      },
    }, // swachComplaintType2Step
    swachGeoLocation: {
      question: {
        en_IN:
          "Please share your location if you are at the Observation site.\n\n👉  Refer the image below to understand steps for sharing the location.",
        hi_IN:
          "यदि आप शिकायत स्थल पर हैं तो कृपया अपना स्थान साझा करें।\n\n👉 स्थान साझा करने के चरणों को समझने के लिए नीचे दी गई छवि देखें।",
        pa_IN:
          "ਜੇ ਤੁਸੀਂ ਸ਼ਿਕਾਇਤ ਵਾਲੀ ਥਾਂ ਤੇ ਹੋ ਤਾਂ ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਸਥਾਨ ਸਾਂਝਾ ਕਰੋ.\n\n👉 ਸਥਾਨ ਨੂੰ ਸਾਂਝਾ ਕਰਨ ਦੇ ਕਦਮਾਂ ਨੂੰ ਸਮਝਣ ਲਈ ਹੇਠ ਦਿੱਤੇ ਚਿੱਤਰ ਨੂੰ ਵੇਖੋ.",
      },
    }, // swachGeoLocation
    swachAttendenceGeoLocation: {
      question: {
        en_IN:
          "Please share your location if you are at the Attendance site.\n\n👉  Refer the image below to understand steps for sharing the location.",
        hi_IN:
          "यदि आप उपस्थिति स्थल पर हैं तो कृपया अपना स्थान साझा करें।\n\n👉 स्थान साझा करने के चरणों को समझने के लिए नीचे दी गई छवि देखें।",
        pa_IN:
          "ਜੇ ਤੁਸੀਂ ਹਾਜ਼ਰੀ ਵਾਲੀ ਥਾਂ ਤੇ ਹੋ ਤਾਂ ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਸਥਾਨ ਸਾਂਝਾ ਕਰੋ.\n\n👉 ਸਥਾਨ ਨੂੰ ਸਾਂਝਾ ਕਰਨ ਦੇ ਕਦਮਾਂ ਨੂੰ ਸਮਝਣ ਲਈ ਹੇਠ ਦਿੱਤੇ ਚਿੱਤਰ ਨੂੰ ਵੇਖੋ.",
      },
    },
    swachConfirmLocation: {
      confirmCityAndLocality: {
        en_IN:
          "Is this the correct location of the Observation?\nCity: {{city}}\nLocality: {{locality}}\n\nType and send *1* if it is correct to confirm and proceedt\nElse, type and send *2*.",
        hi_IN:
          "क्या यह शिकायत का सही स्थान है?शहर: {{city}}स्थान: {{locality}}\n\nटाइप करें और 1 भेजें यदि यह गलत है\nअन्यथा, पुष्टि करने और आगे बढ़ने के लिए 2 टाइप करें और भेजें",
        pa_IN:
          "ਕੀ ਇਹ ਸ਼ਿਕਾਇਤ ਦਾ ਸਹੀ ਸਥਾਨ ਹੈ?ਸ਼ਹਿਰ: {{city}}ਸਥਾਨ: {{locality}}\n\nਟਾਈਪ ਕਰੋ ਅਤੇ 1 ਭੇਜੋ ਜੇ ਇਹ ਗਲਤ ਹੈ\nਹੋਰ, ਪੁਸ਼ਟੀ ਕਰਨ ਅਤੇ ਅੱਗੇ ਵਧਣ ਲਈ ਟਾਈਪ ਕਰੋ ਅਤੇ 2 ਭੇਜੋ",
      },
      confirmCity: {
        en_IN:
          "Is this the correct location of the Observation?\nCity: {{city}}\n\nType and send *1* if it is correct  to confirm and proceed\nElse, type and send *2*",
        hi_IN:
          "क्या यह शिकायत का सही स्थान है?\nशहर: {{city}}\n\nयदि यह सही है तो पुष्टि करने और आगे बढ़ने के लिए 1 टाइप करें और भेजें\nअन्यथा, 2 टाइप करें और भेजें",
        pa_IN:
          "ਕੀ ਇਹ ਸ਼ਿਕਾਇਤ ਦਾ ਸਹੀ ਸਥਾਨ ਹੈ?\nਸ਼ਹਿਰ: {{city}}\n\nਜੇ ਇਹ ਸਹੀ ਹੈ ਤਾਂ ਪੁਸ਼ਟੀ ਕਰਨ ਅਤੇ ਅੱਗੇ ਵਧਣ ਲਈ 1 ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ\nਹੋਰ, 2 ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ",
      },
    },
    swachAttendanceConfirmLocation: {
      confirmCityAndLocality: {
        en_IN:
          "Is this the correct location of the Attendence?\nCity: {{city}}\nLocality: {{locality}}\n\nType and send *1* if it is correct to confirm and proceedt\nElse, type and send *2*.",
        hi_IN:
          "क्या यह उपस्थिति का सही स्थान है?शहर: {{city}}स्थान: {{locality}}\n\nटाइप करें और 1 भेजें यदि यह गलत है\nअन्यथा, पुष्टि करने और आगे बढ़ने के लिए 2 टाइप करें और भेजें",
        pa_IN:
          "ਕੀ ਇਹ ਸ਼ਿਕਾਇਤ ਦਾ ਸਹੀ ਸਥਾਨ ਹੈ?ਸ਼ਹਿਰ: {{city}}ਸਥਾਨ: {{locality}}\n\nਟਾਈਪ ਕਰੋ ਅਤੇ 1 ਭੇਜੋ ਜੇ ਇਹ ਗਲਤ ਹੈ\nਹੋਰ, ਪੁਸ਼ਟੀ ਕਰਨ ਅਤੇ ਅੱਗੇ ਵਧਣ ਲਈ ਟਾਈਪ ਕਰੋ ਅਤੇ 2 ਭੇਜੋ",
      },
      confirmCity: {
        en_IN:
          "Is this the correct location of the Attendence?\nCity: {{city}}\n\nType and send *1* if it is correct  to confirm and proceed\nElse, type and send *2*",
        hi_IN:
          "क्या यह उपस्थिति का सही स्थान है?\nशहर: {{city}}\n\nयदि यह सही है तो पुष्टि करने और आगे बढ़ने के लिए 1 टाइप करें और भेजें\nअन्यथा, 2 टाइप करें और भेजें",
        pa_IN:
          "ਕੀ ਇਹ ਸ਼ਿਕਾਇਤ ਦਾ ਸਹੀ ਸਥਾਨ ਹੈ?\nਸ਼ਹਿਰ: {{city}}\n\nਜੇ ਇਹ ਸਹੀ ਹੈ ਤਾਂ ਪੁਸ਼ਟੀ ਕਰਨ ਅਤੇ ਅੱਗੇ ਵਧਣ ਲਈ 1 ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ\nਹੋਰ, 2 ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ",
      },
    },
    city: {
      question: {
        preamble: {
          en_IN:
            "Please select your city from the link given below. Tap on the link to search and select your city.",
          hi_IN:
            "कृपया नीचे दिए गए लिंक से अपने शहर का चयन करें। अपने शहर को खोजने और चुनने के लिए लिंक पर टैप करें।",
          pa_IN:
            "ਕਿਰਪਾ ਕਰਕੇ ਹੇਠਾਂ ਦਿੱਤੇ ਲਿੰਕ ਤੋਂ ਆਪਣੇ ਸ਼ਹਿਰ ਦੀ ਚੋਣ ਕਰੋ। ਆਪਣੇ ਸ਼ਹਿਰ ਨੂੰ ਖੋਜਣ ਅਤੇ ਚੁਣਨ ਲਈ ਲਿੰਕ 'ਤੇ ਟੈਪ ਕਰੋ।",
        },
      },
    }, // city
    locality: {
      question: {
        preamble: {
          en_IN:
            "Please select the locality of your Observation from the link below. Tap on the link to search and select a locality.",
          hi_IN:
            "कृपया नीचे दिए गए लिंक से अपनी शिकायत के इलाके का चयन करें। किसी इलाके को खोजने और चुनने के लिए लिंक पर टैप करें।",
          pa_IN:
            "ਕਿਰਪਾ ਕਰਕੇ ਹੇਠਾਂ ਦਿੱਤੇ ਲਿੰਕ ਤੋਂ ਆਪਣੀ ਸ਼ਿਕਾਇਤ ਦੇ ਇਲਾਕੇ ਦੀ ਚੋਣ ਕਰੋ। ਕਿਸੇ ਇਲਾਕੇ ਨੂੰ ਖੋਜਣ ਅਤੇ ਚੁਣਨ ਲਈ ਲਿੰਕ 'ਤੇ ਟੈਪ ਕਰੋ।",
        },
      },
    }, // locality
    swachImageUpload: {
      question: {
        en_IN: "Please attach a photo of your Observation.",
        hi_IN: "कृपया अपनी शिकायत की एक फोटो संलग्न करें।",
        pa_IN: "ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੀ ਸ਼ਿਕਾਇਤ ਦੀ ਇੱਕ ਫੋਟੋ ਜੁੜੀ ਹੋਈ ਭੇਜੋ।",
      },
      error: {
        en_IN: "Sorry, I didn't understand",
        hi_IN: "क्षमा करें, मुझे समझ नहीं आया ।",
        pa_IN: "ਮਾਫ ਕਰਨਾ, ਮੈਂ ਸਮਝ ਨਹੀਂ ਸਕਿਆ",
      },
    },
    swachDescription: {
      question: {
        en_IN: "Please type your Observation Description",
        hi_IN: "कृपया अपनी शिकायत का विवरण टाइप करें",
        pa_IN: "ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੀ ਸ਼ਿਕਾਇਤ ਦਾ ਵੇਰਵਾ ਟਾਈਪ ਕਰੋ",
      },
    },
    persistSwachComplaint: {
      en_IN:
        "Thank You 😃 Your Observation is registered successfully with Swach.\n\nThe Observation No is : *{{complaintNumber}}*",
      hi_IN:
        "धन्यवाद 😃 आपकी शिकायत Swach के साथ सफलतापूर्वक दर्ज हो गई है।\nशिकायत संख्या है: {{complaintNumber}}",
      pa_IN:
        "ਧੰਨਵਾਦ 😃 ਤੁਹਾਡੀ ਸ਼ਿਕਾਇਤ Swach ਨਾਲ ਸਫਲਤਾਪੂਰਵਕ ਰਜਿਸਟਰ ਹੋਈ ਹੈ.\nਸ਼ਿਕਾਇਤ ਨੰਬਰ ਹੈ: {{complaintNumber}}",
    },
    closingStatement: {
      en_IN: '\nIn case of Going to Swach Menu please type and send "Swach"',
      hi_IN: '\nस्वच मेनू पर जाने के लिए कृपया "Swach" टाइप करें और भेजें',
      pa_IN:
        "\nਜੇਕਰ ਤੁਸੀਂ ਸਵਚ ਮੀਨੂ 'ਤੇ ਜਾਣਾ ਚਾਹੁੰਦੇ ਹੋ ਤਾਂ ਕਿਰਪਾ ਕਰਕੇ 'Swach' ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ",
    },
    swachCityFuzzySearch: {
      question: {
        en_IN: "Enter the name of your city.",
        hi_IN: "अपने शहर का नाम दर्ज करें। ",
        pa_IN: "ਆਪਣੇ ਸ਼ਹਿਰ ਦਾ ਨਾਮ ਦਰਜ ਕਰੋ. ",
      },
      confirmation: {
        en_IN:
          "Did you mean *“{{city}}”* ?\n\n👉  Type and send *1* to confirm.\n\n👉  Type and send *2* to write again.",
        hi_IN:
          "क्या आपका मतलब *“{{city}}”* से था ?\n\n👉 टाइप करें और पुष्टि करने के लिए 1 भेजें।\n\n👉 टाइप करें और फिर से लिखने के लिए 2 भेजें।",
        pa_IN:
          "ਕੀ ਤੁਹਾਡਾ ਮਤਲਬ *“{{city}}”* ਹੈ ?\n\n👉 ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ 1 ਲਿਖੋ ਅਤੇ ਭੇਜੋ.\n\n👉 ਟਾਈਪ ਕਰੋ ਅਤੇ ਦੁਬਾਰਾ ਲਿਖਣ ਲਈ 2 ਭੇਜੋ.",
      },
      noRecord: {
        en_IN:
          "Provided city is miss-spelled or not present in our system record.\nPlease enter the details again.",
        hi_IN:
          "आपके द्वारा दर्ज किया गया शहर गलत वर्तनी वाला है या हमारे सिस्टम रिकॉर्ड में मौजूद नहीं है।\nकृपया फिर से विवरण दर्ज करें।",
        pa_IN:
          "ਤੁਹਾਡੇ ਦੁਆਰਾ ਦਰਜ ਕੀਤਾ ਗਿਆ ਸ਼ਹਿਰ ਗਲਤ ਵਰਤਨੀ ਵਾਲਾ ਹੈ ਜਾਂ ਸਾਡੇ ਸਿਸਟਮ ਦੇ ਰਿਕਾਰਡ ਵਿੱਚ ਮੌਜੂਦ ਨਹੀਂ ਹੈ।\nਕਿਰਪਾ ਕਰਕੇ ਫਿਰ ਤੋਂ ਵੇਰਵੇ ਦਰਜ ਕਰੋ।",
      },
    },
    swachNlpLocalitySearch: {
      question: {
        en_IN: "Enter the name of your locality.",
        hi_IN: "अपने इलाके का नाम दर्ज करें। (उदाहरण के लिए - Evergreen Park)",
        pa_IN: "ਆਪਣੇ ਸਥਾਨ ਦਾ ਨਾਮ ਦਰਜ ਕਰੋ. (ਉਦਾਹਰਣ ਵਜੋਂ - Evergreen Park)",
      },
      confirmation: {
        en_IN:
          "Did you mean *“{{locality}}”* ?\n\n👉  Type and send *1* to confirm.\n\n👉  Type and send *2* to write again.",
        hi_IN:
          "क्या आपका मतलब *“{{locality}}”* से था ?\n\n👉 टाइप करें और पुष्टि करने के लिए 1 भेजें।\n\n👉 टाइप करें और फिर से लिखने के लिए 2 भेजें।",
        pa_IN:
          "ਕੀ ਤੁਹਾਡਾ ਮਤਲਬ *“{{locality}}”* ਹੈ ?\n\n👉 ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ 1 ਲਿਖੋ ਅਤੇ ਭੇਜੋ.\n\n👉 ਟਾਈਪ ਕਰੋ ਅਤੇ ਦੁਬਾਰਾ ਲਿਖਣ ਲਈ 2 ਭੇਜੋ.",
      },
      noRecord: {
        en_IN:
          "Provided locality is miss-spelled or not present in our system record.\nPlease enter the details again.",
        hi_IN:
          "आपके द्वारा दर्ज किया गया स्थान गलत वर्तनी वाला है या हमारे सिस्टम रिकॉर्ड में मौजूद नहीं है।\nकृपया फिर से विवरण दर्ज करें।",
        pa_IN:
          "ਤੁਹਾਡੇ ਦੁਆਰਾ ਦਰਜ ਕੀਤਾ ਗਿਆ ਸਥਾਨ ਗਲਤ ਵਰਤਨੀ ਵਾਲਾ ਹੈ ਜਾਂ ਸਾਡੇ ਸਿਸਟਮ ਦੇ ਰਿਕਾਰਡ ਵਿੱਚ ਮੌਜੂਦ ਨਹੀਂ ਹੈ।\nਕਿਰਪਾ ਕਰਕੇ ਫਿਰ ਤੋਂ ਵੇਰਵੇ ਦਰਜ ਕਰੋ।",
      },
    },
  },

  // swach file complaint
  swachTrackComplaint: {
    noRecords: {
      en_IN:
        "Sorry 😥 No Observations are found registered from this mobile number.\n\n👉 To go back to the main menu, type and send Swach.",
      hi_IN:
        "अब आपके द्वारा पंजीकृत कोई खुली शिकायत नहीं है।\nमुख्य मेनू पर वापस जाने के लिए ‘Swach’ टाइप करें और भेजें ।",
      pa_IN:
        "ਮਾਫ ਕਰਨਾ 😥 ਇਸ ਮੋਬਾਈਲ ਨੰਬਰ ਤੋਂ ਰਜਿਸਟਰ ਕੀਤੀਆਂ ਗਈਆਂ ਕੋਈ ਸ਼ਿਕਾਇਤਾਂ ਨਹੀਂ ਮਿਲੀਆਂ।\n\n👉 ਮੁੱਖ ਮੇਨੂ ਤੇ ਵਾਪਸ ਜਾਣ ਲਈ, Swach ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ।",
    },
    results: {
      preamble: {
        en_IN: "Following are your open Observations",
        hi_IN: "आपकी खुली शिकायतें निम्नलिखित हैं",
        pa_IN: "ਤੁਹਾਡੀਆਂ ਖੁੱਲੀਆਂ ਸ਼ਿਕਾਇਤਾਂ ਹੇਠ ਲਿਖੀਆਂ ਹਨ",
      },
      complaintTemplate: {
        en_IN:
          "*{{complaintType}}*\n\nFiled Date: {{filedDate}}\n\nCurrent Observation Status: *{{complaintStatus}}*",
        hi_IN:
          "*{{complaintType}}*\n\nदायर तिथि: {{filedDate}}\n\nशिकायत की स्थिति: *{{complaintStatus}}*",
        pa_IN:
          "*{{complaintType}}*\n\nਦਾਇਰ ਮਿਤੀ: {{filedDate}}\n\nਸ਼ਿਕਾਇਤ ਦੀ ਸਥਿਤੀ: *{{complaintStatus}}*",
      },
      closingStatement: {
        en_IN: "👉 To go back to the main menu, type and send swach.",
        hi_IN: "👉 मुख्य मेनू पर वापस जाने के लिए, टाइप करें और swach भेजें।",
        pa_IN: "👉 ਮੁੱਖ ਮੀਨੂ 'ਤੇ ਵਾਪਸ ਜਾਣ ਲਈ, swach ਟਾਈਪ ਕਰੋ ਅਤੇ ਭੇਜੋ।",
      },
    },
  },
};

// grammer
let grammer = {
  swachmenu: {
    question: [
      {
        intention: "file_new_swach_complaint",
        recognize: ["1", "swach", "cleaning", "garbage"],
      },
      {
        intention: "track_existing_swach_complaints",
        recognize: ["2", "track swach", "garbage track"],
      },
      {
        intention: "attendence",
        recognize: ["3", "fill", "attendance"],
      },
    ],
  },
  confirmation: {
    choice: [
      { intention: "Yes", recognize: ["1"] },
      { intention: "No", recognize: ["2"] },
    ],
  },
};

module.exports = swach;
