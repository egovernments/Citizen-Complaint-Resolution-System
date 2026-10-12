import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormComposerV2,} from '@egovernments/digit-ui-components';
import PropTypes from 'prop-types';
import {  Modal, CloseSvg, Close } from "@egovernments/digit-ui-react-components";
import _ from "lodash";


const CloseBtn = (props) => {
  return (
    <div onClick={props?.onClick} style={props?.isMobileView ? { padding: 5 } : null}>
      {props?.isMobileView ? (
        <CloseSvg />
      ) : (
        <div className={"icon-bg-secondary"} style={{ backgroundColor: "#FFFFFF" }}>
          <Close />
        </div>
      )}
    </div>
  );
};

const ModalHeading = (props) => {
  return <h1 className="heading-m">{props.label}</h1>;
};

// FormComposerV2 resets the form whenever a non-empty defaultValues changes, so the form
// starts from one stable empty object.
const NO_DEFAULTS = {};

const PGRWorkflowModal = ({ 
  selectedAction,
  config,
  onSubmit, 
  closeModal,
  popupModuleActionBarStyles,
  popupModuleMianStyles 
}) => {

    
  const { t } = useTranslation();
  // What this opening of the modal has entered. It lives and dies with the modal: closing
  // it for any reason drops it, and each action starts empty. It used to be one session
  // object shared by every action and merged into on each change, so an employee picked
  // in Assign survived a cancel and was submitted with a later Resolve (#1967).
  const [formData, setFormData] = useState(NO_DEFAULTS);

  const onFormValueChange = (setValue, values) => {
    if (!_.isEqual(formData, values)) setFormData(values);
  };

  if (!config || !selectedAction) return null;

  return (
    <Modal
     popupStyles={{ width: "48.438rem", borderRadius: "0.25rem", height: "fit-content" }}
      headerBarMainStyle={{ padding: 0, margin: 0 }}
      headerBarMain={<ModalHeading style={{ fontSize: "1.5rem" }} label={t(config?.label?.heading)} />}
      actionCancelLabel={t(config.label.cancel)}     
      actionCancelOnSubmit={closeModal}
      actionSaveLabel={t(config.label.submit)}
      actionSaveOnSubmit={() => onSubmit(formData)}
      headerBarEnd={<CloseBtn onClick={closeModal} />}
      formId="modal-action"
    >
      <FormComposerV2
        config={config.form}
        noBoxShadow
        inline
        childrenAtTheBottom
        onFormValueChange={onFormValueChange}
        defaultValues={NO_DEFAULTS}
        formId="modal-action"
      />
    </Modal>
  );
};

PGRWorkflowModal.propTypes = {
  selectedAction: PropTypes.shape({
    action: PropTypes.string.isRequired,
  }),
  config: PropTypes.shape({
    label: PropTypes.object.isRequired,
    form: PropTypes.array.isRequired,
  }).isRequired,
  onSubmit: PropTypes.func.isRequired,
  closeModal: PropTypes.func.isRequired,
  popupModuleActionBarStyles: PropTypes.object,
  popupModuleMianStyles: PropTypes.object,
};

export default PGRWorkflowModal;
