# =============================================================================
# SNS — Alarm notification topic
# CloudWatch alarms publish here; operators subscribe via email.
# =============================================================================

resource "aws_sns_topic" "alarms" {
  name = "${local.prefix}-alarms"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}
