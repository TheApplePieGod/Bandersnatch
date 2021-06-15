const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');

var config = {
    entry: './src/frontend/app.tsx',
    target: 'web',
    devtool: 'source-map',
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
    }, 
    module: {
      rules: [
      {
        test: /\.ts(x?)$/,
        include: [/src/, /bandersnatch-wasm/],
        loader: "awesome-typescript-loader"
      },
      {
        test: /\.worker\.js$/,
        include: /src/,
        loader: "worker-loader",
      },
      {
        test: /\.css$/,
        exclude: /node_modules/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|ttf|otf|woff|woff2|eot)$/,
        exclude: /node_modules/,
        loader: 'url-loader'
      }
    ]
    },
    devServer: {
      contentBase: path.join(__dirname, './dist'),
      historyApiFallback: true,
      compress: true,
      hot: true,
      port: 4000,
      publicPath: '/',
    },
    output: {
      path: path.resolve(__dirname, './dist'),
      filename: '[name].bundle.js'
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './html/index.html'
      })
    ],
    experiments: {
        asyncWebAssembly: true
    }
  };

module.exports = config;