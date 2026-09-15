type MedicationMessageInput = {
  displayName?: string;
  medicineName: string;
  dosage: string;
};

type ChatMessageInput = {
  groupName?: string;
  displayName: string;
  content: string;
};

function medicineText(input: MedicationMessageInput) {
  return `${input.medicineName} ${input.dosage}`.trim();
}

export function buildMedicationDueNotification(input: MedicationMessageInput) {
  return {
    title: "복약 시간입니다",
    body: `${medicineText(input)}을 복용할 시간이에요.`
  };
}

export function buildMedicationCompletedNotification(input: MedicationMessageInput & { displayName: string }) {
  return {
    title: "복약 완료",
    body: `${input.displayName}님이 ${medicineText(input)} 복약을 완료했습니다.`
  };
}

export function buildMedicationEscalatedNotification(input: MedicationMessageInput & { displayName: string }) {
  return {
    title: "복약 확인이 필요합니다",
    body: `${input.displayName}님이 아직 ${medicineText(input)} 복약을 확인하지 않았습니다.`
  };
}

export function buildChatNotification(input: ChatMessageInput) {
  return {
    title: input.groupName ?? "새 메시지",
    body: `${input.displayName}: ${input.content}`
  };
}
