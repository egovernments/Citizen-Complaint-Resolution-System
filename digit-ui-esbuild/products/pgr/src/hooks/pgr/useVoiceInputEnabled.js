import { useMemo } from "react";
import { voiceInputEnabled } from "../../utils/uiConstants";

/**
 * Whether File a Complaint offers voice input, from MDMS
 * RAINMAKER-PGR.UIConstants.VOICE_INPUT. On unless the tenant set it to false.
 * Off while the master loads, so a tenant that turned it off never sees the
 * mic flash up; a tenant without the key (or the master) gets it once loaded.
 * The query is the one useReopenWindow makes, so the two share a request.
 */
const useVoiceInputEnabled = (tenantId) => {
  const { data, isLoading } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "UIConstants" }],
    {
      select: (d) => d?.["RAINMAKER-PGR"]?.UIConstants,
    },
    { schemaCode: "RAINMAKER-PGR.UIConstants" }
  );

  return useMemo(() => !isLoading && voiceInputEnabled(data), [data, isLoading]);
};

export default useVoiceInputEnabled;
