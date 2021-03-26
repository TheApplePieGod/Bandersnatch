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
        include: /src/,
        loader: "awesome-typescript-loader"
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|ttf|otf|woff|woff2|eot)$/,
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
      filename: 'bundle.js'
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './html/index.html'
      })
    ],
  };

module.exports = config;