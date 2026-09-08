import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './index.css';

// 主题 token 与 index.css :root 变量保持一致
const theme = {
  token: {
    colorPrimary: '#1677ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#13c2c2',
    colorBgLayout: '#f5f7fa',
    colorText: '#1d2129',
    colorTextSecondary: '#4e5969',
    colorTextTertiary: '#86909c',
    colorBorder: '#e5e6eb',
    colorBorderSecondary: '#f0f0f0',
    borderRadius: 8,
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={theme}>
      {/* AntdApp 提供 message/Modal.confirm 的上下文版本，避免静态方法脱离主题 */}
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
