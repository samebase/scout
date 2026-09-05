import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, CircleAlertIcon, CornerDownRightIcon } from "lucide-react";
import { ReviewShell } from "./shell";

export function ReviewLanding() {
  return (
    <ReviewShell>
      <main id="main-content" className="review-landing">
        <div className="review-hero">
          <div className="review-hero__copy">
            <h1>
              A review you
              <br />
              can watch.
            </h1>
            <p>Send Scout a link and a task. Get findings with the recording behind them.</p>
            <Link to="/chats" className="review-button">
              Open the Lab <ArrowRightIcon size={18} aria-hidden="true" />
            </Link>
            <div className="review-use-case">
              <CornerDownRightIcon size={17} aria-hidden="true" />
              <span>
                Try a signup flow. Investigate a rough edge.
                <br />
                See what a fresh pair of eyes notices.
              </span>
            </div>
          </div>
          <div className="review-landing-example">
            <div className="review-landing-example__heading">
              <span>EXAMPLE / SIGNUP FLOW</span>
              <span>SCOUT REVIEW</span>
            </div>
            <div
              className="review-snapshot"
              role="img"
              aria-label="Illustrated signup screen: the error clears the form"
            >
              <div className="review-snapshot__chrome" aria-hidden="true">
                <span />
                <span />
                <span />
                <span className="review-snapshot__address">example.app / signup</span>
              </div>
              <div className="review-snapshot__body" aria-hidden="true">
                <div className="review-snapshot__form">
                  <h3>Create your account</h3>
                  <span>Email</span>
                  <div className="review-snapshot__field" />
                  <span>Password</span>
                  <div className="review-snapshot__field" />
                  <div className="review-snapshot__error">
                    <CircleAlertIcon size={13} /> Something went wrong.
                  </div>
                  <div className="review-snapshot__submit">Create account</div>
                </div>
              </div>
            </div>
            <div className="review-landing-example__finding">
              <span>02</span>
              <p>The error clears the form.</p>
            </div>
          </div>
        </div>
      </main>
    </ReviewShell>
  );
}
