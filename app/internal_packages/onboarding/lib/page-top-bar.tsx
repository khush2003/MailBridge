import React from 'react';
import { AccountStore, localized } from 'mailspring-exports';
import { RetinaImg } from 'mailspring-component-kit';
import * as OnboardingActions from './onboarding-actions';

const PageTopBar = (props: { pageDepth: number; allowMoveBack?: boolean }) => {
  const { pageDepth } = props;

  const closeClass = pageDepth > 1 ? 'back' : 'close';
  const closeIcon = pageDepth > 1 ? 'onboarding-back.png' : 'onboarding-close.png';
  const closeAction = () => {
    const webview = document.querySelector('webview') as Electron.WebviewTag;
    if (webview && webview.canGoBack()) {
      webview.goBack();
    } else if (pageDepth > 1) {
      OnboardingActions.moveToPreviousPage();
    } else {
      if (AccountStore.accounts().length === 0) {
        AppEnv.quit();
      } else {
        AppEnv.close();
      }
    }
  };

  let backButton = (
    <button
      type="button"
      className={closeClass}
      aria-label={localized(pageDepth > 1 ? 'Back' : 'Close')}
      onClick={closeAction}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          closeAction();
        }
      }}
    >
      <RetinaImg name={closeIcon} mode={RetinaImg.Mode.ContentPreserve} />
    </button>
  );
  if (props.pageDepth > 1 && !props.allowMoveBack) {
    backButton = null;
  }

  const style: any = {
    top: 0,
    left: 26,
    right: 0,
    height: 27,
    zIndex: 100,
    position: 'absolute',
    WebkitAppRegion: 'drag',
  };
  return (
    <div className="dragRegion" style={style}>
      {backButton}
    </div>
  );
};

export default PageTopBar;
