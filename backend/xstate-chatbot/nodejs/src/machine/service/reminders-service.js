const channelProvider = require('../../channel')
const envVariables = require('../../env-variables');
const dialog = require('../util/dialog.js');
const repoProvider = require('../../session/repo');
const fetch = require("node-fetch");
const userService = require('../../session/user-service');
const { toNationalNumber } = require('../../phone-numbers');


class RemindersService {
  async triggerReminders() {
    console.log('Sending reminders to people');
    let userIdList = await repoProvider.getUserId(true);
    await this.sendMessages(userIdList);
    console.log('Reminders execution end');
  }

  async sendMessages(userIdList) {
      // slice(2) stripped India's 91 from any number, whatever its country.
      const extraInfo = {
        whatsAppBusinessNumber: toNationalNumber(envVariables.whatsAppBusinessNumber),
      };
      
      for (let userId of userIdList) {
        let chatState = await repoProvider.getActiveStateForUserId(userId);
        // getActiveStateForUserId returns undefined for a finished session, and
        // the sweep reads chatState.value straight after.
        // menu is a QuestionState, so it compiles to a triplet — the value is
        // { pgr: { menu: 'question' } }, not a bare 'menu'.
        if (!chatState || chatState.value === 'start' || chatState.value?.pgr?.menu === 'question')
          continue;

        let mobileNumber = await this.getMobileNumberFromUserId(userId);
        if (mobileNumber == null)
          continue;

        let user = { mobileNumber: mobileNumber };
        let message = dialog.get_message(messages.reminder, chatState.context.user.locale);
        channelProvider.sendMessageToUser(user, [message], extraInfo);
      }
  }


  async getMobileNumberFromUserId(userId){
    let url = envVariables.egovServices.egovServicesHost + 'user/_search';

    // RequestInfo was null, so egov-user rejected every lookup and the sweep
    // silently reminded nobody.
    const { response } = await userService.withServiceAccount(({ authToken, userInfo }) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: userService.serviceRequestInfo(authToken, userInfo),
          uuid: [userId],
          userType: "CITIZEN"
        })
      })
    );

    if(response.status == 200){
      let responseBody = await response.json();
      const user = (responseBody.user || [])[0];
      return (user && user.mobileNumber) || null;
    }

    return null;
  }

}

// "egov" was India's reset word; nothing here responds to it.
let messages = {
  reminder:{
    en_IN: 'You have not selected any option.\n\n👉 To continue, send your choice, or type *reset* to start over.',
    pt_PT: 'Não selecionou nenhuma opção.\n\nPara continuar, envie a sua escolha, ou escreva *reiniciar* para começar de novo.',
    hi_IN: 'आपने कोई विकल्प नहीं चुना है।\n\n👉 जारी रखने के लिए, कृपया टाइप करें और egov भेजें',
    pa_IN: 'ਤੁਸੀਂ ਕੋਈ ਵਿਕਲਪ ਨਹੀਂ ਚੁਣਿਆ ਹੈ.\n\n👉 ਜਾਰੀ ਰੱਖਣ ਲਈ, ਕਿਰਪਾ ਕਰਕੇ ਟਾਈਪ ਕਰੋ ਅਤੇ egov ਭੇਜੋ'
  }

}

module.exports = new RemindersService();