import _ from 'underscore';
import React, { CSSProperties } from 'react';
import * as Actions from '../flux/actions';
import { RetinaImg } from './retina-img';
import { localized } from '../intl';

type ModalProps = {
  className?: string;
  height?: number;
  width?: number;
};

type ModalState = {
  animateClass: boolean;
  offset: number;
};

class Modal extends React.Component<ModalProps, ModalState> {
  _mounted = false;
  _previousActiveElement: HTMLElement;
  _modalElement: HTMLDivElement;

  state = {
    offset: 0,
    animateClass: false,
  };

  componentDidMount() {
    this._mounted = true;
    this._previousActiveElement = document.activeElement as HTMLElement;
    this._focusImportantElement();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!this._mounted) return;
        this.setState({ animateClass: true });
      });
    });
  }

  componentWillUnmount() {
    this._mounted = false;
    if (this._previousActiveElement?.isConnected) this._previousActiveElement.focus();
  }

  _focusableElements = () => {
    return Array.from(
      this._modalElement.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, a[href], [tabindex]'
      )
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        element.getClientRects().length > 0
    );
  };

  _focusImportantElement = () => {
    const focusable = this._focusableElements();
    const matches = _.sortBy(focusable, (node) => {
      if ((node as HTMLElement).tabIndex > 0) {
        return (node as HTMLElement).tabIndex;
      } else if (node.nodeName === 'INPUT') {
        return 1000000;
      }
      return 1000001;
    });
    if (matches[0]) {
      (matches[0] as HTMLElement).focus();
    }
  };

  _computeModalStyles = (height, width) => {
    const modalStyle: CSSProperties = {
      height: height,
      maxHeight: '95%',
      width: width,
      maxWidth: '95%',
      overflow: 'auto',
      boxSizing: 'border-box',
      paddingTop: 28,
      position: 'absolute',
      backgroundColor: 'white',
      boxShadow: '0 10px 20px rgba(0,0,0,0.19), inset 0 0 1px rgba(0,0,0,0.5)',
      borderRadius: '5px',
    };
    return { modalStyle };
  };

  _onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      Actions.closeModal();
    } else if (event.key === 'Tab') {
      const focusable = this._focusableElements();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) {
        event.preventDefault();
        this._modalElement.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === this._modalElement)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  render() {
    const { children, height, width } = this.props;
    const { modalStyle } = this._computeModalStyles(height, width);

    return (
      <div
        className={`modal-container ${this.state.animateClass && 'animate'}`}
        onKeyDown={this._onKeyDown}
        onClick={() => Actions.closeModal()}
      >
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          ref={(element) => {
            this._modalElement = element;
          }}
          style={modalStyle}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="modal-close"
            aria-label={localized('Close dialog')}
            onClick={(event) => {
              event.stopPropagation();
              Actions.closeModal();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                Actions.closeModal();
              }
            }}
          >
            <RetinaImg name="modal-close.png" mode={RetinaImg.Mode.ContentDark} />
          </button>
          {children}
        </div>
      </div>
    );
  }
}

export default Modal;
