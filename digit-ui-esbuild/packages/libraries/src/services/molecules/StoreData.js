import { StoreService } from "./Store/service";
import { rememberedLanguage } from "../elements/Localization/rememberedLanguage";

const StoreData = {
  getInitData: () => StoreService.getInitData(),
  getCurrentLanguage: () => Digit.SessionStorage.get("locale") || rememberedLanguage() || Digit.Utils.getDefaultLanguage(),
};

export default StoreData;
