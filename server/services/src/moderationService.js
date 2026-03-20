const BASE_REASON_SCORES = {
  harassment: 0.45,
  threats: 0.75,
  hate: 0.8,
  sexual_content: 0.65,
  spam_scam: 0.55,
  impersonation: 0.6,
  other: 0.35,
};

const THREAT_PATTERNS = [
  /i('| a)?ll kill you/i,
  /hurt you/i,
  /find you/i,
  /watch your back/i,
  /or else/i,
  /i know where you live/i,
  /pay or else/i,
];

const SCAM_PATTERNS = [
  /send money/i,
  /cashapp/i,
  /wire transfer/i,
  /gift card/i,
  /bitcoin/i,
  /crypto/i,
  /investment opportunity/i,
  /urgent payment/i,
];

const HATE_PATTERNS = [
  /slur1/i,
  /slur2/i,
];

function hasPatternMatch(text, patterns) {
  return patterns.some((re) => re.test(text || ''));
}

export function derivePriority(score) {
  if (score < 0.4) return 'LOW';
  if (score < 0.7) return 'MEDIUM';
  if (score < 0.85) return 'HIGH';
  return 'URGENT';
}

export function deriveRecommendedAction(score, distinctMessageReporterCount = 0) {
  if (score >= 0.85) return 'AUTO_HIDE_AND_ESCALATE';
  if (score >= 0.75 && distinctMessageReporterCount >= 2) {
    return 'AUTO_HIDE_AND_ESCALATE';
  }
  if (score >= 0.7) return 'PRIORITY_REVIEW_AND_SOFT_HIDE';
  if (score >= 0.4) return 'PRIORITY_REVIEW';
  return 'QUEUE_REVIEW';
}

export function shouldAutoHide(score, distinctMessageReporterCount = 0) {
  return score >= 0.85 || (score >= 0.75 && distinctMessageReporterCount >= 2);
}

export function scoreReport({
  reason,
  plaintext,
  details,
  isRandomRoom,
  hasAttachments,
  senderPriorOpenReports,
  senderPriorResolvedReports,
  distinctMessageReporterCount,
  distinctSenderReporterCount,
}) {
  let score = BASE_REASON_SCORES[reason] ?? BASE_REASON_SCORES.other;
  const factors = [];

  const combinedText = `${plaintext || ''}\n${details || ''}`;

  if (isRandomRoom) {
    score += 0.1;
    factors.push('random_room_boost');
  }

  if (hasAttachments) {
    score += 0.05;
    factors.push('has_attachments');
  }

  if ((senderPriorOpenReports || 0) > 0) {
    score += 0.08;
    factors.push('prior_open_reports');
  }

  if ((senderPriorResolvedReports || 0) > 0) {
    score += 0.12;
    factors.push('prior_resolved_reports');
  }

  if ((distinctMessageReporterCount || 0) >= 2) {
    score += 0.1;
    factors.push('distinct_reporters_same_message_2_plus');
  }

  if ((distinctSenderReporterCount || 0) >= 3) {
    score += 0.15;
    factors.push('distinct_reporters_same_sender_3_plus');
  }

  if (hasPatternMatch(combinedText, THREAT_PATTERNS)) {
    score += 0.2;
    factors.push('matched_threat_pattern');
  }

  if (hasPatternMatch(combinedText, SCAM_PATTERNS)) {
    score += 0.15;
    factors.push('matched_scam_pattern');
  }

  if (hasPatternMatch(combinedText, HATE_PATTERNS)) {
    score += 0.1;
    factors.push('matched_hate_pattern');
  }

  score = Math.max(0, Math.min(1, score));

  return {
    severityScore: score,
    priority: derivePriority(score),
    recommendedAction: deriveRecommendedAction(
      score,
      distinctMessageReporterCount || 0
    ),
    scoreFactors: factors,
  };
}